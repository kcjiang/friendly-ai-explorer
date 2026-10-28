import hashlib
import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import UUID, uuid4

from PIL import Image
from sqlalchemy import select, text

from app.models.storage import (
    FileGarbage,
    FileOperation,
    StorageEntry,
    StorageSettings,
    UploadTask,
)
from app.models.ticket import Ticket
from app.services import storage_service as s
from app.services.storage_maintenance import drain_garbage, reconcile, sweep
from app.services.storage_media import thumbnail_path
from app.services.upload_service import parts_root
from tests import test_storage as storage_tests


class UploadTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = storage_tests.StorageTests.asyncSetUp
    asyncTearDown = storage_tests.StorageTests.asyncTearDown
    user = storage_tests.StorageTests.user
    upload = storage_tests.StorageTests.upload

    async def begin(self, value=b"hello", name="sample.txt", **extra):
        body = {
            "filename": name,
            "size": len(value),
            "fingerprint": hashlib.sha256(value).hexdigest(),
            "space": "personal",
            "conflict": "keep",
            **extra,
        }
        r = await self.client.post("/api/v1/uploads", json=body)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    async def send(self, task, value):
        size = task["chunk_size"]
        for index, start in enumerate(range(0, len(value), size)):
            chunk = value[start : start + size]
            r = await self.client.put(
                f"/api/v1/uploads/{task['id']}/parts/{index}",
                content=chunk,
                params={"sha256": hashlib.sha256(chunk).hexdigest()},
            )
            self.assertEqual(r.status_code, 200, r.text)

    async def complete(self, task):
        r = await self.client.post(f"/api/v1/uploads/{task['id']}/complete")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    async def ticket(self):
        seq = await self.db.scalar(text("SELECT nextval('ticket_seq')"))
        ticket = Ticket(
            id=uuid4(),
            ticket_no=f"ft{seq}",
            system_seq=seq,
            title="Upload test",
            creator_id=self.owner.id,
            updated_by=self.owner.id,
            assignee_id=self.owner.id,
        )
        self.db.add(ticket)
        await self.db.flush()
        return ticket

    async def test_reservation_rejects_overcommit_and_cancel_releases(self):
        config = await self.db.get(StorageSettings, 1)
        config.total_bytes = 8
        config.default_personal_bytes = 8
        await self.db.commit()
        task = await self.begin(b"12345")
        info = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual(
            (
                info["used_bytes"],
                info["reserved_bytes"],
                info["personal_reserved_bytes"],
            ),
            (0, 5, 5),
        )
        r = await self.client.post(
            "/api/v1/uploads",
            json={"filename": "next.txt", "size": 5, "fingerprint": "a" * 64},
        )
        self.assertEqual(r.status_code, 413)
        r = await self.client.delete(f"/api/v1/uploads/{task['id']}")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["reserved_bytes"], 0
        )

    async def test_chunk_resume_hash_and_idempotent_finalize(self):
        value = b"abcdefghijklmnopqrst"
        with (
            patch("app.services.upload_service.THRESHOLD", 16),
            patch("app.services.upload_service.CHUNK_SIZE", 8),
        ):
            task = await self.begin(value)
        self.assertEqual(task["chunk_size"], 8)
        url = f"/api/v1/uploads/{task['id']}"
        first = value[:8]
        params = {"sha256": hashlib.sha256(first).hexdigest()}
        self.assertEqual(
            (
                await self.client.put(url + "/parts/0", content=first, params=params)
            ).status_code,
            200,
        )
        self.assertEqual(
            (
                await self.client.put(url + "/parts/0", content=first, params=params)
            ).status_code,
            200,
        )
        self.assertEqual((await self.client.post(url + "/complete")).status_code, 409)
        self.assertEqual(
            (
                await self.client.put(
                    url + "/parts/1", content=value[8:16], params={"sha256": "f" * 64}
                )
            ).status_code,
            409,
        )
        restored = (await self.client.get(url)).json()
        self.assertEqual(len(restored["parts"]), 1)
        for i in (1, 2):
            chunk = value[i * 8 : (i + 1) * 8]
            self.assertEqual(
                (
                    await self.client.put(
                        url + f"/parts/{i}",
                        content=chunk,
                        params={"sha256": hashlib.sha256(chunk).hexdigest()},
                    )
                ).status_code,
                200,
            )
        complete = await self.complete(task)
        again = await self.complete(task)
        self.assertEqual(complete["entry_id"], again["entry_id"])
        entry = await self.db.get(StorageEntry, UUID(complete["entry_id"]))
        self.assertEqual(entry.sha256, hashlib.sha256(value).hexdigest())
        self.assertEqual(s.disk_path(entry.space, entry.path).read_bytes(), value)
        self.assertFalse(parts_root(task["id"]).exists())
        usage = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual((usage["used_bytes"], usage["reserved_bytes"]), (20, 0))

    async def test_task_ownership_and_creation_idempotency(self):
        key = str(uuid4())
        task = await self.begin(upload_id=key)
        duplicate = await self.begin(upload_id=key)
        self.assertEqual(task["id"], duplicate["id"])
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["reserved_bytes"], 5
        )
        self.current = self.dev
        for method, suffix in (("get", ""), ("delete", ""), ("post", "/complete")):
            self.assertEqual(
                (
                    await getattr(self.client, method)(
                        f"/api/v1/uploads/{key}" + suffix
                    )
                ).status_code,
                404,
            )

    async def test_invalid_images_reject_and_valid_thumbnail_counts(self):
        image = io.BytesIO()
        Image.new("RGB", (100, 50), "red").save(image, "PNG")
        data = image.getvalue()
        invalid = await self.begin(data, "fake.jpg")
        await self.send(invalid, data)
        self.assertEqual(
            (
                await self.client.post(f"/api/v1/uploads/{invalid['id']}/complete")
            ).status_code,
            400,
        )
        await self.client.delete(f"/api/v1/uploads/{invalid['id']}")
        task = await self.begin(data, "image.png")
        await self.send(task, data)
        complete = await self.complete(task)
        entry = await self.db.get(StorageEntry, UUID(complete["entry_id"]))
        self.assertGreater(entry.thumbnail_size, 0)
        self.assertTrue(thumbnail_path(entry.id).is_file())
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["personal_bytes"],
            len(data) + entry.thumbnail_size,
        )
        self.assertEqual(
            (await self.client.get(f"/api/v1/files/{entry.id}/thumbnail")).status_code,
            200,
        )
        self.current = self.other
        self.assertEqual(
            (await self.client.get(f"/api/v1/files/{entry.id}/thumbnail")).status_code,
            404,
        )
        self.current = self.owner
        copied = await self.client.post(
            f"/api/v1/files/{entry.id}/transfer",
            json={"space": "personal", "copy": True},
        )
        self.assertEqual(copied.status_code, 200, copied.text)
        duplicate = await s.active(self.db, s.personal(self.owner), "image (2).png")
        self.assertIsNotNone(duplicate)
        self.assertEqual(duplicate.thumbnail_size, entry.thumbnail_size)
        self.assertTrue(thumbnail_path(duplicate.id).is_file())
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["personal_bytes"],
            2 * (len(data) + entry.thumbnail_size),
        )
        await self.client.delete(f"/api/v1/files/{entry.id}")
        self.assertFalse(thumbnail_path(entry.id).exists())
        self.assertTrue(thumbnail_path(duplicate.id).exists())
        await self.client.delete(f"/api/v1/files/{duplicate.id}")
        self.assertFalse(thumbnail_path(duplicate.id).exists())

    async def test_image_dimensions_are_checked_before_decode(self):
        image = io.BytesIO()
        Image.new("RGB", (100, 100)).save(image, "PNG")
        data = image.getvalue()
        task = await self.begin(data, "image.png")
        await self.send(task, data)
        with patch("app.services.storage_media.MAX_PIXELS", 100):
            self.assertEqual(
                (
                    await self.client.post(f"/api/v1/uploads/{task['id']}/complete")
                ).status_code,
                400,
            )
        self.assertEqual(
            list(s.space_root(s.personal(self.owner)).glob("image.png")), []
        )

    async def attach(self, ticket, task):
        current = (await self.client.get(f"/api/v1/tickets/{ticket.id}")).json()
        result = await self.client.patch(
            f"/api/v1/tickets/{ticket.id}",
            json={"revision": current["revision"], "upload_ids": [task["id"]]},
        )
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    async def test_attachments_use_only_pool_and_archive_is_read_only(self):
        ticket = await self.ticket()
        config = await self.db.get(StorageSettings, 1)
        config.default_personal_bytes = 0
        await self.db.commit()
        task = await self.begin(purpose="attachment", ticket_id=str(ticket.id))
        reserved = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual(
            (reserved["reserved_bytes"], reserved["personal_reserved_bytes"]), (5, 0)
        )
        await self.send(task, b"hello")
        done = await self.complete(task)
        self.assertEqual(
            (await self.client.get("/api/v1/files/ticket-archive")).json()["total"], 0
        )
        record = await self.attach(ticket, task)
        usage = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual((usage["used_bytes"], usage["personal_bytes"]), (5, 0))
        archive = (await self.client.get("/api/v1/files/ticket-archive")).json()
        self.assertEqual(archive["total"], 1)
        self.assertEqual(archive["items"][0]["id"], done["entry_id"])
        self.assertIn(ticket.ticket_no, archive["items"][0]["ticket_name"])
        self.assertEqual(
            (
                await self.client.get(
                    "/api/v1/files/ticket-archive", params={"q": "missing"}
                )
            ).json()["total"],
            0,
        )
        ident = done["entry_id"]
        for verb, suffix, body in [
            ("delete", "", None),
            ("patch", "/name", {"name": "new.txt"}),
            ("post", "/transfer", {"space": "personal", "copy": True}),
            ("put", "/content", {"content": "edit"}),
            ("put", "/shares", {"user_ids": [str(self.other.id)]}),
        ]:
            response = await self.client.request(
                verb,
                f"/api/v1/files/{ident}" + suffix,
                **({"json": body} if body is not None else {}),
            )
            self.assertIn(response.status_code, (403, 404, 405))
        self.current = self.other
        self.assertEqual(
            (await self.client.get(f"/api/v1/files/{ident}/download")).status_code, 200
        )
        self.assertEqual(
            (await self.client.get("/api/v1/files/ticket-archive")).json()["total"], 0
        )
        self.assertEqual(
            (
                await self.client.patch(
                    f"/api/v1/tickets/{ticket.id}",
                    json={
                        "revision": record["revision"],
                        "delete_attachment_ids": [ident],
                    },
                )
            ).status_code,
            403,
        )
        self.current = self.owner
        self.assertEqual(
            (
                await self.client.patch(
                    f"/api/v1/tickets/{ticket.id}",
                    json={
                        "revision": record["revision"],
                        "delete_attachment_ids": [ident],
                    },
                )
            ).status_code,
            200,
        )
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["used_bytes"], 0
        )
        self.assertEqual(
            (await self.client.get("/api/v1/files/ticket-archive")).json()["total"], 0
        )
        events = (
            await self.db.scalars(
                select(FileOperation)
                .where(FileOperation.entry_id == UUID(ident))
                .order_by(FileOperation.created_at)
            )
        ).all()
        self.assertEqual(
            [e.action for e in events], ["upload_attachment", "delete_attachment"]
        )
        self.assertEqual(events[-1].details["size"], 5)
        self.assertEqual(events[-1].details["actor_name"], self.owner.name)

    async def test_comments_reject_attachments_and_do_not_delete_ticket_files(self):
        ticket = await self.ticket()
        task = await self.begin(purpose="attachment", ticket_id=str(ticket.id))
        await self.send(task, b"hello")
        done = await self.complete(task)
        await self.attach(ticket, task)
        invalid = await self.client.post(
            f"/api/v1/tickets/{ticket.id}/comments",
            json={"content": "internal", "upload_ids": [task["id"]]},
        )
        self.assertEqual(invalid.status_code, 422)
        comment = await self.client.post(
            f"/api/v1/tickets/{ticket.id}/comments",
            json={"content": "internal", "is_internal": True},
        )
        self.assertEqual(comment.status_code, 201, comment.text)
        self.current = self.other
        self.assertEqual(
            (
                await self.client.get(f"/api/v1/files/{done['entry_id']}/download")
            ).status_code,
            200,
        )
        self.assertEqual(
            (await self.client.get(f"/api/v1/tickets/{ticket.id}")).json()["comments"],
            [],
        )
        self.current = self.owner
        record = (await self.client.get(f"/api/v1/tickets/{ticket.id}")).json()
        response = await self.client.delete(
            f"/api/v1/tickets/{ticket.id}/comments/{comment.json()['id']}",
            params={"revision": record["revision"]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["attachments"]), 1)
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["used_bytes"], 5
        )

    async def test_personal_copy_is_independent_and_reassignment_retains_files(self):
        item = await self.upload()
        ticket = await self.ticket()
        response = await self.client.post(
            "/api/v1/uploads/from-entry",
            json={"entry_id": item["id"], "ticket_id": str(ticket.id)},
        )
        self.assertEqual(response.status_code, 201, response.text)
        task = response.json()
        record = await self.attach(ticket, task)
        usage = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual((usage["used_bytes"], usage["personal_bytes"]), (10, 5))
        await self.client.delete(f"/api/v1/files/{item['id']}")
        for status in ("resolved", "open"):
            response = await self.client.patch(
                f"/api/v1/tickets/{ticket.id}",
                json={
                    "revision": record["revision"],
                    "status": status,
                    "assignee_id": str(self.other.id),
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            record = response.json()
            self.assertEqual(len(record["attachments"]), 1)
        self.current = self.other
        self.assertEqual(
            (
                await self.client.get(f"/api/v1/files/{task['entry_id']}/download")
            ).content,
            b"hello",
        )
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["personal_bytes"], 0
        )
        copied_again = await self.client.post(
            "/api/v1/uploads/from-entry",
            json={"entry_id": task["entry_id"], "ticket_id": str(ticket.id)},
        )
        self.assertEqual(copied_again.status_code, 403)

    async def test_upload_permissions_follow_all_four_edit_roles(self):
        from app.models.user import UserRole

        ticket = await self.ticket()
        leader = self.user("lead", UserRole.leader)
        self.db.add(leader)
        ticket.assignee_id = self.other.id
        await self.db.commit()
        for user in (self.owner, self.other, self.dev, leader):
            self.current = user
            task = await self.begin(purpose="attachment", ticket_id=str(ticket.id))
            await self.client.delete(f"/api/v1/uploads/{task['id']}")
        outsider = self.user("outsider")
        self.db.add(outsider)
        await self.db.commit()
        self.current = outsider
        result = await self.client.post(
            "/api/v1/uploads",
            json={
                "filename": "x.txt",
                "size": 5,
                "fingerprint": "a" * 64,
                "purpose": "attachment",
                "ticket_id": str(ticket.id),
            },
        )
        self.assertEqual(result.status_code, 403)

    async def test_delete_ticket_cleans_files_thumbnails_and_pending_chunks(self):
        ticket = await self.ticket()
        image = io.BytesIO()
        Image.new("RGB", (50, 50)).save(image, "PNG")
        data = image.getvalue()
        task = await self.begin(
            data, "image.png", purpose="attachment", ticket_id=str(ticket.id)
        )
        await self.send(task, data)
        done = await self.complete(task)
        record = await self.attach(ticket, task)
        entry = await self.db.get(StorageEntry, UUID(done["entry_id"]))
        original = s.disk_path(entry.space, entry.path)
        thumb = thumbnail_path(entry.id)
        active = await self.begin(purpose="attachment", ticket_id=str(ticket.id))
        await self.send(active, b"hello")
        draft = await self.begin(purpose="attachment", ticket_id=str(ticket.id))
        await self.send(draft, b"hello")
        await self.complete(draft)
        response = await self.client.delete(
            f"/api/v1/tickets/{ticket.id}", params={"revision": record["revision"]}
        )
        self.assertEqual(response.status_code, 200, response.text)
        await sweep(self.db)
        self.assertFalse(original.exists())
        self.assertFalse(thumb.exists())
        self.assertFalse(parts_root(active["id"]).exists())
        self.assertFalse((await self.db.scalars(select(StorageEntry))).all())
        self.assertFalse((await self.db.scalars(select(FileGarbage))).all())
        usage = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual((usage["used_bytes"], usage["reserved_bytes"]), (0, 0))
        events = (
            await self.db.scalars(
                select(FileOperation).where(
                    FileOperation.action == "delete_ticket_attachments"
                )
            )
        ).all()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].details["count"], 1)

    async def test_attachment_delete_failure_keeps_only_pool_charge_until_retry(self):
        ticket = await self.ticket()
        task = await self.begin(purpose="attachment", ticket_id=str(ticket.id))
        await self.send(task, b"hello")
        done = await self.complete(task)
        record = await self.attach(ticket, task)
        entry = await self.db.get(StorageEntry, UUID(done["entry_id"]))
        target = s.disk_path(entry.space, entry.path)
        unlink = Path.unlink

        def blocked(path, *args, **kwargs):
            if path == target:
                raise PermissionError("fixture locked")
            return unlink(path, *args, **kwargs)

        with patch.object(Path, "unlink", blocked):
            result = await self.client.patch(
                f"/api/v1/tickets/{ticket.id}",
                json={
                    "revision": record["revision"],
                    "delete_attachment_ids": [done["entry_id"]],
                },
            )
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["attachments"], [])
        self.assertTrue(target.exists())
        usage = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual((usage["used_bytes"], usage["personal_bytes"]), (5, 0))
        await drain_garbage(self.db)
        self.assertFalse(target.exists())
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["used_bytes"], 0
        )

    async def test_stale_edit_and_invalid_attachment_selection_never_delete_files(self):
        ticket = await self.ticket()
        task = await self.begin(purpose="attachment", ticket_id=str(ticket.id))
        await self.send(task, b"hello")
        done = await self.complete(task)
        record = await self.attach(ticket, task)
        result = await self.client.patch(
            f"/api/v1/tickets/{ticket.id}",
            json={
                "revision": record["revision"] - 1,
                "delete_attachment_ids": [done["entry_id"]],
            },
        )
        self.assertEqual(result.status_code, 409)
        result = await self.client.patch(
            f"/api/v1/tickets/{ticket.id}",
            json={
                "revision": record["revision"],
                "delete_attachment_ids": [done["entry_id"], str(uuid4())],
            },
        )
        self.assertEqual(result.status_code, 404)
        self.assertEqual(
            (
                await self.client.get(f"/api/v1/files/{done['entry_id']}/download")
            ).content,
            b"hello",
        )
        self.assertFalse((await self.db.scalars(select(FileGarbage))).all())

    async def test_abandoned_tasks_and_pending_attachments_expire(self):
        task = await self.begin()
        await self.send(task, b"hello")
        pending = await self.begin(purpose="attachment")
        await self.send(pending, b"hello")
        done = await self.complete(pending)
        for ident in (task["id"], pending["id"]):
            row = await self.db.get(UploadTask, UUID(ident))
            row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await self.db.commit()
        await sweep(self.db)
        self.assertFalse(parts_root(task["id"]).exists())
        self.assertIsNone(await self.db.get(StorageEntry, UUID(done["entry_id"])))
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["reserved_bytes"], 0
        )

    async def test_disk_delete_failure_keeps_ledger_and_quota_until_retry(self):
        item = await self.upload()
        target = s.disk_path(s.personal(self.owner), "test.txt")
        original = Path.unlink

        def blocked(path, *args, **kwargs):
            if path == target:
                raise PermissionError("test lock")
            return original(path, *args, **kwargs)

        with patch.object(Path, "unlink", blocked):
            self.assertEqual(
                (await self.client.delete(f"/api/v1/files/{item['id']}")).status_code,
                200,
            )
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["personal_bytes"], 5
        )
        self.assertTrue((await self.db.scalars(select(FileGarbage))).all())
        await drain_garbage(self.db)
        self.assertFalse(target.exists())
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["used_bytes"], 0
        )

    async def test_reconcile_registers_external_bytes_and_missing_files_without_deleting(
        self,
    ):
        root = s.space_root(s.personal(self.owner))
        root.mkdir(parents=True)
        (root / "external.txt").write_bytes(b"external")
        await reconcile(self.db)
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["used_bytes"], 8
        )
        (root / "external.txt").unlink()
        result = await reconcile(self.db)
        self.assertEqual(result["missing"], 1)
        self.assertIsNotNone(
            await s.active(self.db, s.personal(self.owner), "external.txt")
        )

    async def test_published_upload_receipt_recovers_after_process_interruption(self):
        task = await self.begin()
        await self.send(task, b"hello")
        target = s.disk_path(s.personal(self.owner), "sample.txt")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"hello")
        (parts_root(task["id"]) / "receipt.json").write_text(
            json.dumps(
                {
                    "space": s.personal(self.owner),
                    "path": "sample.txt",
                    "sha256": hashlib.sha256(b"hello").hexdigest(),
                }
            ),
            encoding="utf-8",
        )
        await sweep(self.db)
        row = await self.db.get(UploadTask, UUID(task["id"]))
        self.assertEqual(row.status, "complete")
        self.assertEqual(row.reserved_bytes, 0)
        self.assertIsNotNone(row.entry_id)
        self.assertFalse(parts_root(task["id"]).exists())
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["personal_bytes"], 5
        )

    async def test_attachment_move_without_database_commit_is_rolled_back(self):
        task = await self.begin(purpose="attachment")
        await self.send(task, b"hello")
        done = await self.complete(task)
        entry = await self.db.get(StorageEntry, UUID(done["entry_id"]))
        old = s.disk_path(entry.space, entry.path)
        space = f"ticket/{uuid4()}"
        new = s.disk_path(space, "sample.txt")
        new.parent.mkdir(parents=True, exist_ok=True)
        old.rename(new)
        from app.config import settings

        journal = (
            Path(settings.storage_dir).resolve()
            / "attachment-transfers"
            / f"{entry.id}.json"
        )
        journal.parent.mkdir(parents=True, exist_ok=True)
        journal.write_text(
            json.dumps(
                {
                    "entry_id": str(entry.id),
                    "old_space": entry.space,
                    "old_path": entry.path,
                    "space": space,
                    "path": "sample.txt",
                }
            ),
            encoding="utf-8",
        )
        await sweep(self.db)
        self.assertTrue(old.exists())
        self.assertFalse(new.exists())
        self.assertFalse(journal.exists())

    async def test_expired_task_can_be_cancelled_immediately(self):
        task = await self.begin()
        row = await self.db.get(UploadTask, UUID(task["id"]))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await self.db.commit()
        result = await self.client.delete(f"/api/v1/uploads/{task['id']}")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(row.reserved_bytes, 0)
