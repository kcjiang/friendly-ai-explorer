import unittest
from datetime import datetime, timezone
from uuid import UUID

from app.models.storage import StorageEntry
from app.services.device_logs import log_name
from tests import test_uploads


class LogNames(unittest.TestCase):
    def test_local_time_and_preserved_client_name(self):
        at = datetime(2026, 10, 29, 6, 35, 8, tzinfo=timezone.utc)
        self.assertRegex(
            log_name("adb", at=at, offset=-480),
            r"^adb_20261029_143508_[0-9a-f]{4}\.log$",
        )
        self.assertRegex(
            log_name("serial", at=at, offset=420),
            r"^serial_20261028_233508_[0-9a-f]{4}\.log$",
        )
        name = "adb_20261029_143508_a1b2.log"
        self.assertEqual(log_name("adb", name, at=at, offset=420), name)
        self.assertNotEqual(
            log_name("adb", "adb_20260230_143508_a1b2.log", at=at),
            "adb_20260230_143508_a1b2.log",
        )


class DeviceLogs(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_uploads.UploadTests.asyncSetUp
    asyncTearDown = test_uploads.UploadTests.asyncTearDown
    user = test_uploads.UploadTests.user
    upload = test_uploads.UploadTests.upload
    begin = test_uploads.UploadTests.begin
    send = test_uploads.UploadTests.send
    complete = test_uploads.UploadTests.complete

    async def test_upload_destinations_collision_mixed_history_and_permissions(self):
        name = "adb_20261029_143508_a1b2.log"
        entries = []
        for value in (b"first\n", b"second\n"):
            task = await self.begin(value, name, purpose="log", device_type="adb")
            await self.send(task, value)
            result = await self.complete(task)
            entry = await self.db.get(StorageEntry, UUID(result["entry_id"]))
            self.assertRegex(
                entry.path, r"^DeviceLogs/adb/adb_20261029_143508_[0-9a-f]{4}\.log$"
            )
            entries.append(entry)
        self.assertEqual(entries[0].path, f"DeviceLogs/adb/{name}")
        self.assertNotEqual(entries[0].path, entries[1].path)
        for entry, content in zip(entries, (b"first\n", b"second\n")):
            self.assertEqual(
                (await self.client.get(f"/api/v1/files/{entry.id}/download")).content,
                content,
            )

        serial_name = "serial_20200101_000000_beef.log"
        response = await self.client.post(
            "/api/v1/debug/logs",
            files={"file": (serial_name, b"serial\n")},
            data={"device_type": "serial"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        manual = await self.upload("manual.log", b"manual", parent="DeviceLogs/serial")
        mixed = (await self.client.get("/api/v1/debug/logs", params={"page": 1})).json()
        self.assertEqual(mixed["total"], 4)
        self.assertEqual(
            [item["filename"] for item in mixed["items"]][:2],
            ["manual.log", serial_name],
        )
        self.assertEqual(mixed["items"][0]["storage_entry_id"], manual["id"])
        self.assertIsNone(mixed["items"][0]["line_count"])
        filtered = (
            await self.client.get(
                "/api/v1/debug/logs", params={"page": 1, "device_type": "adb"}
            )
        ).json()
        self.assertEqual(filtered["total"], 2)
        for user in (self.other, self.dev):
            self.current = user
            self.assertEqual(
                (
                    await self.client.get("/api/v1/debug/logs", params={"page": 1})
                ).json()["total"],
                0,
            )
            self.assertIn(
                (
                    await self.client.get(f"/api/v1/files/{entries[0].id}/download")
                ).status_code,
                (403, 404),
            )
