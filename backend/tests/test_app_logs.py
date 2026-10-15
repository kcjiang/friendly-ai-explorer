import json
import logging
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi import FastAPI

from app.config import settings
from app.logging_config import JSONLogFormatter, redact, request_id_context, safe_data
from app.main import app
from app.middleware.auth import get_current_user
from app.middleware.request_logging import RequestLoggingMiddleware
from app.models.user import User, UserRole
from app.services.app_log_service import read_logs


class LogStorageTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.directory = Path(self.folder.name)
        self.config = patch.object(settings, "log_dir", self.folder.name)
        self.config.start()
        self.addCleanup(self.config.stop)
        self.addCleanup(self.folder.cleanup)

    def row(self, number, level="INFO", request_id="test-request"):
        return {"id": str(number), "timestamp": f"2026-10-15T10:00:{number:02d}+00:00", "level": level, "logger": "app.test", "message": f"event {number}", "request_id": request_id, "details": {}}

    def write(self, name, rows):
        (self.directory / name).write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")

    def test_newest_first_across_rotation_and_filters(self):
        self.write("app.jsonl.1", [self.row(1), self.row(2, "ERROR")])
        self.write("app.jsonl", [self.row(3), self.row(4, "ERROR"), self.row(5, request_id="another-request")])
        self.assertEqual([r["id"] for r in read_logs()["items"]], ["5", "4", "3", "2", "1"])
        self.assertEqual([r["id"] for r in read_logs(level="ERROR")["items"]], ["4", "2"])
        self.assertEqual(read_logs(request_id="another-request")["total"], 1)
        self.assertEqual(read_logs(q="EVENT 3")["total"], 1)
        self.assertEqual(read_logs(page=2, page_size=2)["items"][0]["id"], "3")
        self.assertEqual(read_logs(since=datetime(2026, 10, 15, 10, 0, 3, tzinfo=timezone.utc), until=datetime(2026, 10, 15, 10, 0, 4, tzinfo=timezone.utc))["total"], 2)

    def test_partial_write_and_search_bound(self):
        self.write("app.jsonl", [self.row(1)] * 10002)
        with (self.directory / "app.jsonl").open("a", encoding="utf-8") as file:
            file.write('{"partial')
        result = read_logs()
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["items"]), 50)
        self.assertLessEqual(result["total"], 10000)

    def test_redaction_includes_nested_fields_and_read_boundary(self):
        text = redact('Authorization: Bearer secret-value api_key=another-secret sk-abcdefghij https://user:password@example.test/v1')
        self.assertNotIn("secret-value", text)
        self.assertNotIn("another-secret", text)
        self.assertNotIn("sk-abcdefghij", text)
        self.assertNotIn("user:password", text)
        nested = safe_data({"prompt": "private ticket body", "meta": {"password": "private", "status": 503}})
        self.assertEqual(nested["prompt"], "[REDACTED]")
        self.assertEqual(nested["meta"]["status"], 503)
        self.write("app.jsonl", [{**self.row(1), "message": "API Key=private-token"}])
        self.assertNotIn("private-token", json.dumps(read_logs()))

    def test_formatter_keeps_request_id_and_safe_exception_frames(self):
        token = request_id_context.set("test-correlated-id")
        try:
            try:
                raise ValueError("private SQL values and sk-raw-secret")
            except ValueError:
                import sys
                record = logging.LogRecord("app.test", logging.ERROR, __file__, 1, "处理失败", (), sys.exc_info())
            result = JSONLogFormatter().format(record)
            data = json.loads(result)
            self.assertEqual(data["request_id"], "test-correlated-id")
            self.assertEqual(data["details"]["exception_type"], "ValueError")
            self.assertTrue(data["details"]["stack"])
            self.assertNotIn("private SQL", result)
            self.assertNotIn("sk-raw-secret", result)
        finally:
            request_id_context.reset(token)


class LogAPITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.config = patch.object(settings, "log_dir", self.folder.name)
        self.config.start()
        self.user = User(id=uuid4(), role=UserRole.developer)
        async def user():
            return self.user
        app.dependency_overrides[get_current_user] = user
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        app.dependency_overrides.clear()
        self.config.stop()
        self.folder.cleanup()

    async def test_developer_only_and_date_validation(self):
        response = await self.client.get("/api/v1/admin/logs")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"], [])
        self.assertIn("x-request-id", response.headers)
        self.assertEqual((await self.client.get("/api/v1/admin/logs", params={"since": "2026-10-16T00:00:00Z", "until": "2026-10-15T00:00:00Z"})).status_code, 422)
        self.assertEqual((await self.client.get("/api/v1/admin/logs", params={"page_size": 1000})).status_code, 422)
        self.user.role = UserRole.engineer
        self.assertEqual((await self.client.get("/api/v1/admin/logs")).status_code, 403)

    async def test_request_id_propagates_and_resets(self):
        response = await self.client.get("/health", headers={"X-Request-ID": "trace-test-12345"})
        self.assertEqual(response.headers["x-request-id"], "trace-test-12345")
        self.assertEqual(request_id_context.get(), "")
        second = await self.client.get("/health")
        self.assertNotEqual(second.headers["x-request-id"], "trace-test-12345")

    async def test_unexpected_exception_returns_safe_correlated_error(self):
        isolated = FastAPI()
        isolated.add_middleware(RequestLoggingMiddleware)
        @isolated.get("/fail")
        async def fail():
            raise ValueError("private business value sk-should-not-leak")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=isolated), base_url="http://test") as client:
            response = await client.get("/fail")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["request_id"], response.headers["x-request-id"])
        self.assertNotIn("private business", response.text)


if __name__ == "__main__":
    unittest.main()
