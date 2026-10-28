"""Storage authorization, real filesystem operations and quota integration tests.

All business rows roll back and all files live in a TemporaryDirectory. No real
user files, uploads, or embedding services are used.
"""

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import engine, get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.models.document import Document
from app.models.preset import UploadedLog
from app.models.storage import FileOperation, StorageEntry, StorageSettings
from app.models.user import User, UserRole
from app.services import storage_service as s


class StorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = patch.object(settings, "storage_dir", self.temp.name)
        self.config.start()
        self.index = patch("app.routers.storage.run_index", AsyncMock())
        self.index.start()
        self.conn = await engine.connect()
        self.tx = await self.conn.begin()
        self.db = AsyncSession(
            bind=self.conn,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        self.owner = self.user("owner")
        self.other = self.user("other")
        self.dev = self.user("developer", UserRole.developer)
        self.db.add_all([self.owner, self.other, self.dev])
        await self.db.flush()
        self.current = self.owner

        async def database():
            yield self.db

        async def current():
            return self.current

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = current
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )

    def user(self, name, role=UserRole.engineer):
        return User(
            id=uuid4(),
            name=name,
            email=f"{uuid4()}@example.test",
            password_hash="test",
            role=role,
            is_active=True,
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        app.dependency_overrides.clear()
        await self.db.close()
        await self.tx.rollback()
        await self.conn.close()
        await engine.dispose()
        self.index.stop()
        self.config.stop()
        self.temp.cleanup()

    async def upload(
        self,
        name="test.txt",
        value=b"hello",
        space="personal",
        parent="",
        conflict="keep",
    ):
        response = await self.client.post(
            "/api/v1/files/upload",
            files={"file": (name, value)},
            data={"space": space, "parent": parent, "conflict": conflict},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    async def folder(self, name, space="public", parent=""):
        r = await self.client.post(
            "/api/v1/files/folders",
            json={"space": space, "parent": parent, "name": name},
        )
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    async def test_listing_sorts_before_pagination_and_validates_sort(self):
        await self.upload("zebra.txt", b"a", "public")
        await self.upload("apple.txt", b"aaaa", "public")
        await self.upload("middle.txt", b"aa", "public")
        for sort, direction, expected in [
            ("name", "asc", ["apple.txt", "middle.txt", "zebra.txt"]),
            ("name", "desc", ["zebra.txt", "middle.txt", "apple.txt"]),
            ("size", "asc", ["zebra.txt", "middle.txt", "apple.txt"]),
            ("size", "desc", ["apple.txt", "middle.txt", "zebra.txt"]),
            ("updated_at", "desc", ["middle.txt", "apple.txt", "zebra.txt"]),
        ]:
            names = []
            for page in range(1, 4):
                r = await self.client.get(
                    "/api/v1/files/entries",
                    params={
                        "sort": sort,
                        "direction": direction,
                        "page_size": 1,
                        "page": page,
                    },
                )
                self.assertEqual(r.status_code, 200, r.text)
                self.assertEqual(r.json()["total"], 3)
                names.extend(item["name"] for item in r.json()["items"])
            self.assertEqual(names, expected)
        for endpoint in ["entries", "ticket-archive"]:
            r = await self.client.get(
                f"/api/v1/files/{endpoint}", params={"sort": "invalid"}
            )
            self.assertEqual(r.status_code, 422)

    async def test_personal_files_are_private_even_from_developer(self):
        item = await self.upload()
        for user in (self.other, self.dev):
            self.current = user
            for suffix in ("download", "content", "operations", "shares"):
                r = await self.client.get(f"/api/v1/files/{item['id']}/{suffix}")
                self.assertIn(r.status_code, (403, 404), r.text)
            self.assertEqual(
                (await self.client.delete(f"/api/v1/files/{item['id']}")).status_code,
                403,
            )
            self.assertEqual(
                (
                    await self.client.patch(
                        f"/api/v1/files/{item['id']}", json={"name": "oops.txt"}
                    )
                ).status_code,
                403,
            )

    async def test_folder_share_inheritance_revocation_and_no_mutation(self):
        root = await self.folder("shared", "personal")
        item = await self.upload(parent="shared")
        r = await self.client.put(
            f"/api/v1/files/{root['id']}/shares",
            json={"user_ids": [str(self.other.id)]},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.current = self.other
        self.assertEqual(
            (await self.client.get(f"/api/v1/files/{item['id']}/download")).content,
            b"hello",
        )
        self.assertEqual(
            (
                await self.client.get(
                    "/api/v1/files/entries", params={"shared_id": root["id"]}
                )
            ).json()["total"],
            1,
        )
        self.assertEqual(
            (await self.client.delete(f"/api/v1/files/{item['id']}")).status_code, 403
        )
        self.current = self.owner
        later = await self.upload("later.txt", parent="shared")
        self.current = self.other
        self.assertEqual(
            (
                await self.client.get(f"/api/v1/files/{later['id']}/download")
            ).status_code,
            200,
        )
        self.current = self.owner
        await self.client.put(
            f"/api/v1/files/{root['id']}/shares", json={"user_ids": []}
        )
        self.current = self.other
        self.assertEqual(
            (await self.client.get(f"/api/v1/files/{item['id']}/download")).status_code,
            404,
        )

    async def test_shared_copy_is_independent_and_counts_only_destination(self):
        item = await self.upload()
        await self.client.put(
            f"/api/v1/files/{item['id']}/shares",
            json={"user_ids": [str(self.other.id)]},
        )
        self.current = self.other
        before = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual(before["personal_bytes"], 0)
        r = await self.client.post(
            f"/api/v1/files/{item['id']}/transfer",
            json={"space": "personal", "copy": True},
        )
        self.assertEqual(r.status_code, 200, r.text)
        after = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual(after["personal_bytes"], 5)
        self.assertEqual(after["used_bytes"], 10)
        self.current = self.owner
        await self.client.delete(f"/api/v1/files/{item['id']}")
        self.current = self.other
        copied = (
            await self.client.get("/api/v1/files/entries", params={"space": "personal"})
        ).json()["items"][0]
        self.assertEqual(
            (await self.client.get(f"/api/v1/files/{copied['id']}/download")).content,
            b"hello",
        )

    async def test_public_all_members_manage_but_cannot_move_to_personal(self):
        item = await self.upload(space="public")
        self.current = self.other
        r = await self.client.post(
            f"/api/v1/files/{item['id']}/transfer", json={"space": "personal"}
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(
            (
                await self.client.patch(
                    f"/api/v1/files/{item['id']}", json={"name": "new.txt"}
                )
            ).status_code,
            200,
        )
        self.assertEqual(
            (
                await self.client.post(
                    f"/api/v1/files/{item['id']}/transfer",
                    json={"space": "personal", "copy": True},
                )
            ).status_code,
            200,
        )
        self.assertEqual(
            (await self.client.delete(f"/api/v1/files/{item['id']}")).status_code, 200
        )

    async def test_public_recycle_restore_recreates_parents_and_conflicts(self):
        parent = await self.folder("original")
        item = await self.upload(space="public", parent="original")
        await self.client.delete(f"/api/v1/files/{item['id']}")
        self.assertEqual(
            (await self.client.get(f"/api/v1/files/{item['id']}/download")).status_code,
            404,
        )
        usage = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual(usage["used_bytes"], 5)
        self.assertEqual(
            (
                await self.client.post(f"/api/v1/files/trash/{item['id']}/restore")
            ).status_code,
            403,
        )
        await self.client.delete(f"/api/v1/files/{parent['id']}")
        self.current = self.dev
        r = await self.client.post(f"/api/v1/files/trash/{item['id']}/restore")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(
            (s.space_root("public") / "original/test.txt").read_bytes(), b"hello"
        )
        await self.client.delete(f"/api/v1/files/{item['id']}")
        await self.upload(space="public", parent="original")
        r = await self.client.post(f"/api/v1/files/trash/{item['id']}/restore")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue((s.space_root("public") / "original/test (2).txt").exists())

    async def test_only_developer_can_purge_and_personal_delete_has_no_trash(self):
        item = await self.upload(space="public")
        await self.client.delete(f"/api/v1/files/{item['id']}")
        self.assertEqual(
            (await self.client.delete(f"/api/v1/files/trash/{item['id']}")).status_code,
            403,
        )
        self.current = self.dev
        self.assertEqual(
            (await self.client.delete(f"/api/v1/files/trash/{item['id']}")).status_code,
            200,
        )
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["used_bytes"], 0
        )
        private = await self.upload()
        self.assertEqual(
            (await self.client.delete(f"/api/v1/files/{private['id']}")).status_code,
            200,
        )
        self.assertEqual((await self.client.get("/api/v1/files/trash")).json(), [])
        self.assertFalse(s.disk_path(s.personal(self.dev), "test.txt").exists())

    async def test_conflicts_skip_or_keep_both_never_overwrite(self):
        await self.upload(value=b"first")
        skipped = await self.upload(value=b"second", conflict="skip")
        self.assertTrue(skipped["skipped"])
        second = await self.upload(value=b"second")
        third = await self.upload(value=b"third")
        self.assertEqual(second["name"], "test (2).txt")
        self.assertEqual(third["name"], "test (3).txt")
        self.assertEqual(
            s.disk_path(s.personal(self.owner), "test.txt").read_bytes(), b"first"
        )

    async def test_quota_shared_pool_personal_caps_and_recycle(self):
        self.current = self.dev
        r = await self.client.put(
            "/api/v1/files/capacity",
            json={"total_bytes": 10, "default_personal_bytes": 5, "user_quotas": {}},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.current = self.owner
        await self.upload(value=b"12345")
        denied = await self.client.post(
            "/api/v1/files/upload",
            files={"file": ("extra.txt", b"x")},
            data={"space": "personal"},
        )
        self.assertEqual(denied.status_code, 413)
        public = await self.upload("pool.txt", b"12345", "public")
        self.current = self.other
        self.assertEqual(
            (
                await self.client.post(
                    "/api/v1/files/upload",
                    files={"file": ("extra.txt", b"x")},
                    data={"space": "personal"},
                )
            ).status_code,
            413,
        )
        await self.client.delete(f"/api/v1/files/{public['id']}")
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["used_bytes"], 10
        )
        self.assertEqual(list((Path(self.temp.name) / "temporary").iterdir()), [])

    async def test_personal_to_public_releases_personal_quota_and_grants(self):
        item = await self.upload()
        await self.client.put(
            f"/api/v1/files/{item['id']}/shares",
            json={"user_ids": [str(self.other.id)]},
        )
        r = await self.client.post(
            f"/api/v1/files/{item['id']}/transfer", json={"space": "public"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        info = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual((info["personal_bytes"], info["used_bytes"]), (0, 5))
        self.current = self.other
        self.assertEqual((await self.client.get("/api/v1/files/shared")).json(), [])

    async def test_paths_symlinks_and_recursive_moves_are_rejected(self):
        for parent in ("../outside", "/etc", "a/../b", "a\\b"):
            r = await self.client.get("/api/v1/files/entries", params={"path": parent})
            self.assertEqual(r.status_code, 400, r.text)
        root = await self.folder("root")
        r = await self.client.post(
            f"/api/v1/files/{root['id']}/transfer",
            json={"space": "public", "parent": "root"},
        )
        self.assertEqual(r.status_code, 400)
        (s.space_root("public") / "escape").symlink_to("/etc", target_is_directory=True)
        self.assertEqual(
            (
                await self.client.get(
                    "/api/v1/files/entries", params={"path": "escape"}
                )
            ).status_code,
            400,
        )

    async def test_knowledge_markdown_independent_usage_and_editor_history(self):
        item = await self.upload("guide.md", "# 测试\n正文".encode(), "knowledge")
        doc = await self.db.get(Document, item["document_id"])
        self.assertTrue(doc.is_published)
        info = (await self.client.get("/api/v1/files/usage")).json()
        self.assertEqual(info["used_bytes"], 0)
        self.assertGreater(info["knowledge_bytes"], 0)
        self.current = self.other
        r = await self.client.put(
            f"/api/v1/files/{item['id']}/content", json={"content": "# Updated", "revision": (await self.client.get(f"/api/v1/files/{item['id']}/content")).json()["revision"]}
        )
        self.assertEqual(r.status_code, 200, r.text)
        doc = await self.db.get(Document, item["document_id"])
        self.assertEqual(doc.content, "# Updated")
        operations = (
            await self.client.get(f"/api/v1/files/{item['id']}/operations")
        ).json()
        self.assertIn("edit", [r["action"] for r in operations])
        self.assertEqual(item["creator"]["id"], str(self.owner.id))
        r = await self.client.post(
            "/api/v1/files/upload",
            files={"file": ("tool.exe", b"binary")},
            data={"space": "knowledge"},
        )
        self.assertEqual(r.status_code, 400)

    async def test_device_logs_are_in_owners_folder_and_no_developer_override(self):
        r = await self.client.post(
            "/api/v1/debug/logs",
            files={"file": ("log.txt", b"line1\nline2")},
            data={"device_type": "serial"},
        )
        self.assertEqual(r.status_code, 201, r.text)
        log = r.json()
        row = await self.db.get(UploadedLog, log["id"])
        entry = await self.db.get(StorageEntry, row.storage_entry_id)
        self.assertTrue(entry.path.startswith("DeviceLogs/"))
        self.assertEqual(row.line_count, 2)
        self.current = self.dev
        self.assertEqual(
            (
                await self.client.get(f"/api/v1/debug/logs/{log['id']}/download")
            ).status_code,
            403,
        )
        self.assertEqual(
            (
                await self.client.get(
                    "/api/v1/debug/logs", params={"device_type": "serial"}
                )
            ).json(),
            [],
        )

    async def test_public_legacy_log_urls_are_blocked(self):
        self.assertEqual(
            (await self.client.get("/uploads/device_logs/example.txt")).status_code, 404
        )

    async def test_external_files_appear_and_can_be_scanned_into_knowledge(self):
        root = s.space_root("knowledge")
        root.mkdir(parents=True)
        (root / "external.md").write_text("# external", encoding="utf-8")
        r = await self.client.get(
            "/api/v1/files/entries", params={"space": "knowledge"}
        )
        self.assertEqual(r.json()["items"][0]["creator"], None)
        r = await self.client.post("/api/v1/files/knowledge/sync")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["indexed"], 1)
        entry = await self.db.scalar(
            select(StorageEntry).where(
                StorageEntry.path == "external.md", StorageEntry.space == "knowledge"
            )
        )
        self.assertIsNotNone(entry.document_id)

    async def test_download_ranges_and_head_recheck_permissions(self):
        item = await self.upload(value=b"0123456789")
        url = f"/api/v1/files/{item['id']}/download"
        r = await self.client.get(url, headers={"Range": "bytes=2-5"})
        self.assertEqual(r.status_code, 206)
        self.assertEqual(r.content, b"2345")
        self.assertEqual(r.headers["content-range"], "bytes 2-5/10")
        self.assertEqual(
            (await self.client.get(url, headers={"Range": "bytes=-3"})).content, b"789"
        )
        self.assertEqual(
            (await self.client.get(url, headers={"Range": "bytes=50-"})).status_code,
            416,
        )
        r = await self.client.head(url)
        self.assertEqual(
            (r.status_code, r.content, r.headers["content-length"]), (200, b"", "10")
        )
        self.current = self.dev
        self.assertEqual((await self.client.head(url)).status_code, 404)

    async def test_knowledge_delete_removes_document_and_shared_entry(self):
        item = await self.upload("guide.md", b"# content", "knowledge")
        r = await self.client.delete(f"/api/v1/files/{item['id']}")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNone(await self.db.get(Document, item["document_id"]))
        self.assertEqual((await self.client.get("/api/v1/files/trash")).json(), [])

    async def test_copy_failure_cleans_partial_destination(self):
        item = await self.upload(space="public")

        def broken_copy(source, target):
            Path(target).write_bytes(b"partial")
            raise OSError("simulated disk failure")

        with patch("app.services.storage_service.shutil.copyfile", broken_copy):
            r = await self.client.post(
                f"/api/v1/files/{item['id']}/transfer",
                json={"space": "personal", "copy": True},
            )
        self.assertEqual(r.status_code, 500)
        self.assertFalse(s.disk_path(s.personal(self.owner), "test.txt").exists())
        self.assertEqual(s.disk_path("public", "test.txt").read_bytes(), b"hello")

    async def test_concurrent_uploads_cannot_overcommit_pool(self):
        self.assertEqual(
            settings.environment,
            "test",
            "Concurrency test requires a disposable test database",
        )
        actor = self.user("concurrent")
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            config = await db.get(StorageSettings, 1)
            original = (
                config.total_bytes,
                config.default_personal_bytes,
                dict(config.user_quotas),
            )
            config.total_bytes, config.default_personal_bytes = 10, 10
            db.add(actor)
            await db.commit()

        async def independent_db():
            async with AsyncSessionLocal() as db:
                yield db

        app.dependency_overrides[get_db] = independent_db
        self.current = actor
        try:

            async def send(name):
                return await self.client.post(
                    "/api/v1/files/upload",
                    files={"file": (name, b"123456")},
                    data={"space": "personal"},
                )

            results = await asyncio.gather(send("first.txt"), send("second.txt"))
            self.assertEqual(sorted(r.status_code for r in results), [201, 413])
            self.assertEqual(s.tree_bytes(s.space_root(s.personal(actor))), 6)
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(
                    delete(StorageEntry).where(StorageEntry.space == s.personal(actor))
                )
                await db.execute(
                    delete(FileOperation).where(FileOperation.actor_id == actor.id)
                )
                await db.execute(delete(User).where(User.id == actor.id))
                config = await db.get(StorageSettings, 1)
                (
                    config.total_bytes,
                    config.default_personal_bytes,
                    config.user_quotas,
                ) = original
                await db.commit()

    async def test_conflict_preflight_and_empty_public_recycle_bin(self):
        first = await self.upload("first.txt", space="public")
        second = await self.upload("second.txt", space="public")
        r = await self.client.get(
            "/api/v1/files/exists", params={"space": "public", "name": "first.txt"}
        )
        self.assertTrue(r.json()["exists"])
        for item in (first, second):
            self.assertEqual(
                (await self.client.delete(f"/api/v1/files/{item['id']}")).status_code,
                200,
            )
        history = await self.client.get(f"/api/v1/files/{first['id']}/operations")
        self.assertIn("trash", [row["action"] for row in history.json()])
        self.assertEqual(
            (await self.client.delete("/api/v1/files/trash")).status_code, 403
        )
        self.current = self.dev
        r = await self.client.delete("/api/v1/files/trash")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["removed"], 2)
        self.assertEqual(
            (await self.client.get("/api/v1/files/usage")).json()["used_bytes"], 0
        )

    async def test_log_history_server_pagination_and_renamed_filename(self):
        records = []
        for _ in range(2):
            r = await self.client.post(
                "/api/v1/debug/logs",
                files={"file": ("log.txt", b"line")},
                data={"device_type": "serial"},
            )
            self.assertEqual(r.status_code, 201, r.text)
            records.append(r.json())
        log = await self.db.get(UploadedLog, records[0]["id"])
        r = await self.client.patch(
            f"/api/v1/files/{log.storage_entry_id}", json={"name": "renamed-log.txt"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        page = (
            await self.client.get(
                "/api/v1/debug/logs",
                params={"device_type": "serial", "page": 1, "page_size": 1},
            )
        ).json()
        self.assertEqual((len(page["items"]), page["total"]), (1, 2))
        result = (
            await self.client.get(
                "/api/v1/debug/logs",
                params={"device_type": "serial", "page": 1, "q": "renamed"},
            )
        ).json()
        self.assertEqual(result["items"][0]["filename"], "renamed-log.txt")
        self.assertEqual(
            (await self.client.get(f"/api/v1/debug/logs/{log.id}/download")).content,
            b"line",
        )
