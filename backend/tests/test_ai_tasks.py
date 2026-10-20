"""Rollback-only integration tests: no real Jira or AI requests."""
import unittest
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch
from uuid import uuid4
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import engine, get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.models.user import User, UserRole
from app.models.ai_task import TaskAccount, TaskIssue
from app.schemas.ai_task import DEFAULT_FIELDS
from app.services import ai_task_service as service
from app.services import task_prompt_service as prompt_service
from app.models.ai_task import TaskPrompt

ROOT = "/api/v1/ai-tasks"


class TaskTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.conn = await engine.connect()
        self.tx = await self.conn.begin()
        self.db = AsyncSession(bind=self.conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
        self.user = User(id=uuid4(), name="tasks-test", email=f"{uuid4()}@example.test", role=UserRole.engineer, is_active=True, password_hash="unused")
        self.other = User(id=uuid4(), name="other", email=f"{uuid4()}@example.test", role=UserRole.engineer, is_active=True, password_hash="unused")
        self.db.add_all([self.user, self.other])
        await self.db.commit()
        async def db_override():
            yield self.db
        async def user_override():
            return self.user
        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[get_current_user] = user_override
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        app.dependency_overrides.clear()
        await self.db.close()
        await self.tx.rollback()
        await self.conn.close()
        await engine.dispose()

    async def account(self):
        response = await self.client.post(ROOT + "/accounts", json={"name": "Jira", "base_url": "https://jira.sdmctech.com:9380", "username": "test", "password": "test-secret-123"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def task(self, account):
        response = await self.client.post(ROOT + "/tasks", json={"name": "DRACO", "account_id": account["id"], "jql": "project = DRACO"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def issue(self):
        row = TaskIssue(user_id=self.user.id, site="https://jira.sdmctech.com:9380", issue_key="DRACO-35", source={"title": "Failure", "description": "customer original", "updated": "2026-10-16", "attachments": [], "url": "https://jira.sdmctech.com:9380/browse/DRACO-35"})
        self.db.add(row)
        await self.db.commit()
        return row

    async def test_accounts_encrypt_mask_update_and_validate_host(self):
        account = await self.account()
        row = await self.db.get(TaskAccount, account["id"])
        self.assertNotIn("test-secret-123", row.password_encrypted)
        self.assertEqual(service.password(row), "test-secret-123")
        before = row.password_encrypted
        response = await self.client.put(ROOT + "/accounts/" + account["id"], json={**account, "password": None})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(row.password_encrypted, before)
        overview = (await self.client.get(ROOT)).text
        self.assertNotIn("password", overview)
        self.assertNotIn(before, overview)
        response = await self.client.post(ROOT + "/accounts", json={"name": "bad", "base_url": "https://127.0.0.1", "username": "u", "password": "p"})
        self.assertEqual(response.status_code, 422)

    async def test_user_isolation_for_accounts_tasks_templates_and_issues(self):
        account = await self.account()
        task = await self.task(account)
        issue = await self.issue()
        template = (await self.client.post(ROOT + "/templates", json={"name": "custom", "fields": ["description"]})).json()
        async def other_user():
            return self.other
        app.dependency_overrides[get_current_user] = other_user
        overview = (await self.client.get(ROOT)).json()
        for key in ("accounts", "tasks", "templates", "issues", "runs"):
            self.assertEqual(overview[key], [])
        for method, path, body in [("POST", "/accounts/" + account["id"] + "/test", {}), ("POST", "/tasks/" + task["id"] + "/run", {}), ("POST", f"/issues/{issue.id}/convert", {}), ("PUT", "/templates/" + template["id"], {"name": "x", "fields": ["x"]}), ("PATCH", f"/issues/{issue.id}/processed", {"processed": True})]:
            response = await self.client.request(method, ROOT + path, json=body)
            self.assertEqual(response.status_code, 404, response.text)

    async def test_draft_and_explicit_processed_state(self):
        account = await self.account()
        issue = await self.issue()
        response = await self.client.patch(f"{ROOT}/issues/{issue.id}/processed", json={"processed": True})
        self.assertEqual(response.status_code, 422)
        values = {field: "" for field in DEFAULT_FIELDS}
        item = {"key": "DRACO-35", "fields": {"summary": "Failure", "description": "customer original", "updated": "2026-10-16", "attachment": []}}
        with patch.object(service.JiraClient, "authenticate", AsyncMock()), patch.object(service.JiraClient, "get", AsyncMock(return_value=item)), patch.object(service.JiraClient, "comments", AsyncMock(return_value=[])), patch.object(service, "chat", AsyncMock(return_value=__import__("json").dumps({"fields": values, "evidence": {}}))):
            response = await self.client.post(f"{ROOT}/issues/{issue.id}/convert", json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(issue.processed)
        self.assertEqual(response.json()["fields"]["前置条件"], "")
        self.assertEqual(response.json()["fields"]["客户缺陷原始描述"], "customer original")
        updated = response.json()["fields"]
        updated["前置条件"] = "manually added"
        self.assertEqual((await self.client.put(f"{ROOT}/issues/{issue.id}/draft", json={"fields": updated})).status_code, 200)
        self.assertFalse(issue.processed)
        for state in (True, False):
            response = await self.client.patch(f"{ROOT}/issues/{issue.id}/processed", json={"processed": state})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["processed"], state)

    async def test_scans_deduplicate_and_preserve_draft_and_processing(self):
        account = await self.account()
        task = await self.task(account)
        item = {"key": "DRACO-35", "fields": {"summary": "Failure", "description": "v1"}}
        @asynccontextmanager
        async def same_session():
            yield self.db
        with patch.object(service, "AsyncSessionLocal", same_session), patch.object(service.JiraClient, "search", AsyncMock(return_value=[item])):
            response = await self.client.post(f"{ROOT}/tasks/{task['id']}/run")
            self.assertEqual(response.json()["added"], 1, response.text)
            row = await self.db.scalar(select(TaskIssue).where(TaskIssue.user_id == self.user.id))
            row.draft, row.processed = {"fields": {"x": "saved"}}, True
            await self.db.commit()
            item["fields"]["description"] = "v2"
            response = await self.client.post(f"{ROOT}/tasks/{task['id']}/run")
            self.assertEqual(response.json()["added"], 0)
            self.assertTrue(row.processed)
            self.assertEqual(row.draft["fields"]["x"], "saved")
            self.assertEqual(row.source["description"], "v2")

    async def test_scan_failure_records_error_and_does_not_create_issues(self):
        task = await self.task(await self.account())
        @asynccontextmanager
        async def same_session():
            yield self.db
        with patch.object(service, "AsyncSessionLocal", same_session), patch.object(service.JiraClient, "search", AsyncMock(side_effect=httpx.ConnectError("private data"))):
            response = await self.client.post(f"{ROOT}/tasks/{task['id']}/run")
        self.assertFalse(response.json()["success"])
        self.assertNotIn("private data", response.text)
        overview = (await self.client.get(ROOT)).json()
        self.assertEqual(overview["issues"], [])
        self.assertFalse(overview["runs"][0]["success"])

    async def test_search_paginates_and_authenticates(self):
        account = await self.account()
        row = await self.db.get(TaskAccount, account["id"])
        async with service.JiraClient(row) as jira:
            with patch.object(jira, "get", AsyncMock(side_effect=[{"name": "test"}, {"issues": [{"key": "A-1"}], "total": 2}, {"issues": [{"key": "A-2"}], "total": 2}])) as get:
                self.assertEqual(len(await jira.search("project = A")), 2)
                self.assertEqual(get.call_args_list[2].args[1]["startAt"], 1)

    async def test_partial_scan_rolls_back_and_paused_schedule_does_not_run(self):
        task = await self.task(await self.account())
        @asynccontextmanager
        async def same_session():
            yield self.db
        with patch.object(service, "AsyncSessionLocal", same_session), patch.object(service.JiraClient, "search", AsyncMock(return_value=[{"key": "DRACO-35", "fields": {}}, {"key": "invalid/key", "fields": {}}])) as search:
            self.assertIsNone(await service.scan(__import__("uuid").UUID(task["id"]), self.user.id, scheduled=True))
            search.assert_not_called()
            response = await self.client.post(f"{ROOT}/tasks/{task['id']}/run")
            self.assertFalse(response.json()["success"])
            self.assertEqual((await self.client.get(ROOT)).json()["issues"], [])

    async def test_invalid_ai_output_preserves_existing_draft(self):
        await self.account()
        issue = await self.issue()
        issue.draft = {"fields": {"original": "retained"}}
        await self.db.commit()
        with patch.object(service.JiraClient, "authenticate", AsyncMock()), patch.object(service.JiraClient, "get", AsyncMock(return_value={"key": "DRACO-35", "fields": {}})), patch.object(service.JiraClient, "comments", AsyncMock(return_value=[])), patch.object(service, "chat", AsyncMock(return_value='{"unexpected":"field"}')):
            response = await self.client.post(f"{ROOT}/issues/{issue.id}/convert", json={})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(issue.draft["fields"]["original"], "retained")

    async def test_priority_and_inferred_causes_are_not_used_as_missing_facts(self):
        await self.account()
        issue = await self.issue()
        values = {field: "" for field in DEFAULT_FIELDS}
        values.update({"出现概率": "High", "分析": "红外功能默认未开启", "实际结果": "设备不响应"})
        output = {"fields": values, "evidence": {"出现概率": "High", "分析": "The device does not respond", "实际结果": "The device does not respond"}}
        with patch.object(service.JiraClient, "authenticate", AsyncMock()), patch.object(service.JiraClient, "get", AsyncMock(return_value={"key": "DRACO-35", "fields": {"description": "The device does not respond", "priority": {"name": "High"}}})), patch.object(service.JiraClient, "comments", AsyncMock(return_value=[])), patch.object(service, "chat", AsyncMock(return_value=__import__("json").dumps(output))):
            response = await self.client.post(f"{ROOT}/issues/{issue.id}/convert", json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["fields"]["出现概率"], "")
        self.assertEqual(response.json()["fields"]["分析"], "")
        self.assertEqual(response.json()["fields"]["实际结果"], "设备不响应")

    async def test_model_field_variants_and_missing_attachment_field(self):
        import json
        raw = json.dumps({"**问题表现及描述：**": "现象", "前置条件": None, "复现步骤：": ["第一步", "第二步"], "实际结果": "结果"})
        with patch.object(service, "chat", AsyncMock(return_value=raw)):
            values, evidence = await service.extract_values("prompt", DEFAULT_FIELDS)
        self.assertEqual(values["问题表现及描述"], "现象")
        self.assertEqual(values["复现步骤"], "第一步\n第二步")
        self.assertEqual(values["附件"], "")
        self.assertEqual(list(values), DEFAULT_FIELDS)

    async def test_account_delete_protects_tasks_and_template_validation(self):
        account = await self.account()
        task = await self.task(account)
        self.assertEqual((await self.client.delete(ROOT + "/accounts/" + account["id"])).status_code, 409)
        self.assertEqual((await self.client.delete(ROOT + "/tasks/" + task["id"])).status_code, 200)
        self.assertEqual((await self.client.delete(ROOT + "/accounts/" + account["id"])).status_code, 200)
        self.assertEqual((await self.client.post(ROOT + "/templates", json={"name": "bad", "fields": ["x", "x"]})).status_code, 422)

    async def test_shared_prompts_owner_permissions_revision_and_personal_preferences(self):
        body = {"name": "Accurate FAE", "content": "Preserve the facts and separate observed results from expectations."}
        response = await self.client.post(ROOT + "/prompts", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        ident = response.json()["id"]
        response = await self.client.put(ROOT + "/preferences", json={"prompt_id": ident, "language": "en"})
        self.assertEqual(response.status_code, 200)
        overview = (await self.client.get(ROOT)).json()
        self.assertEqual(overview["preferences"], {"prompt_id": ident, "language": "en"})
        self.assertTrue(next(p for p in overview["prompts"] if p["id"] == ident)["can_edit"])
        async def other_user():
            return self.other
        app.dependency_overrides[get_current_user] = other_user
        overview = (await self.client.get(ROOT)).json()
        visible = next(p for p in overview["prompts"] if p["id"] == ident)
        self.assertEqual(visible["content"], body["content"])
        self.assertFalse(visible["can_edit"])
        self.assertEqual(overview["preferences"]["language"], "zh-CN")
        self.assertEqual((await self.client.put(ROOT + "/prompts/" + ident, json={**body, "revision": 1})).status_code, 403)
        # Everyone can choose a shared prompt without gaining access to its author's data.
        self.assertEqual((await self.client.put(ROOT + "/preferences", json={"prompt_id": ident, "language": "zh-CN"})).status_code, 200)
        async def original_user():
            return self.user
        app.dependency_overrides[get_current_user] = original_user
        response = await self.client.put(ROOT + "/prompts/" + ident, json={**body, "content": body["content"] + " Use concise wording.", "revision": 1})
        self.assertEqual(response.json()["revision"], 2)
        self.assertEqual((await self.client.put(ROOT + "/prompts/" + ident, json={**body, "revision": 1})).status_code, 409)
        self.assertEqual((await self.client.get(ROOT)).json()["preferences"]["language"], "en")
        self.assertEqual((await self.client.put(ROOT + "/preferences", json={"prompt_id": str(uuid4()), "language": "en"})).status_code, 404)
        self.assertEqual((await self.client.put(ROOT + "/preferences", json={"language": "invalid"})).status_code, 422)

    async def test_conversion_uses_preference_language_override_and_prompt_snapshot(self):
        await self.account()
        issue = await self.issue()
        row = TaskPrompt(owner_id=self.other.id, name="Shared prompt", content="Keep accurate technical facts and organize them for internal development.")
        self.db.add(row)
        await self.db.commit()
        await self.client.put(ROOT + "/preferences", json={"prompt_id": str(row.id), "language": "en"})
        item = {"key": "DRACO-35", "fields": {"summary": "Failure", "description": "The device does not respond to the remote control.", "attachment": []}}
        values = {key: "" for key in DEFAULT_FIELDS}
        values["问题表现及描述"] = "The device does not respond to the remote control."
        with patch.object(service.JiraClient, "authenticate", AsyncMock()), patch.object(service.JiraClient, "get", AsyncMock(return_value=item)), patch.object(service.JiraClient, "comments", AsyncMock(return_value=[])), patch.object(service, "chat", AsyncMock(return_value=json.dumps(values))) as model:
            response = await self.client.post(f"{ROOT}/issues/{issue.id}/convert", json={})
        self.assertEqual(response.status_code, 200, response.text)
        draft = response.json()
        self.assertEqual(draft["language"], "en")
        self.assertEqual(draft["prompt_name"], row.name)
        self.assertEqual(draft["prompt_content"], row.content)
        self.assertEqual(draft["field_labels"]["复现步骤"], "Steps to reproduce")
        self.assertEqual(draft["fields"]["客户缺陷原始描述"], item["fields"]["description"])
        self.assertIn(row.content, model.await_args.args[1])
        self.assertIn("输出语言：English", model.await_args.args[1])
        self.assertNotIn("test-secret-123", model.await_args.args[1])
        row.content = "Updated instruction; previous drafts must not change."
        row.revision = 2
        await self.db.commit()
        self.assertEqual(issue.draft["prompt_revision"], 1)
        self.assertEqual(issue.draft["prompt_content"], draft["prompt_content"])
        values["问题表现及描述"] = "设备无法响应遥控器指令。"
        with patch.object(service.JiraClient, "authenticate", AsyncMock()), patch.object(service.JiraClient, "get", AsyncMock(return_value=item)), patch.object(service.JiraClient, "comments", AsyncMock(return_value=[])), patch.object(service, "chat", AsyncMock(return_value=json.dumps(values))) as model:
            response = await self.client.post(f"{ROOT}/issues/{issue.id}/convert", json={"language": "zh-CN"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["language"], "zh-CN")
        self.assertIn("输出语言：简体中文", model.await_args.args[1])
        self.assertEqual((await self.client.get(ROOT)).json()["preferences"]["language"], "en")

    async def test_wrong_language_retries_without_translating_json_keys(self):
        english = {key: "" for key in DEFAULT_FIELDS}
        english["问题表现及描述"] = "The device does not respond to any commands from the remote control."
        chinese = {**english, "问题表现及描述": "设备无法响应遥控器发送的任何控制指令。"}
        with patch.object(service, "chat", AsyncMock(side_effect=[json.dumps(english), chinese["问题表现及描述"]])) as model:
            values, _ = await service.extract_values("translate", DEFAULT_FIELDS, language="zh-CN")
        self.assertEqual(model.await_count, 2)
        self.assertEqual(values["问题表现及描述"], chinese["问题表现及描述"])

        with patch.object(service, "chat", AsyncMock(side_effect=[json.dumps(chinese), english["问题表现及描述"]])) as model:
            values, _ = await service.extract_values("translate", DEFAULT_FIELDS, language="en")
        self.assertEqual(model.await_count, 2)
        self.assertEqual(values["问题表现及描述"], english["问题表现及描述"])
        mixed = {**english, "分析": "这是一段中文分析，但其他字段仍然是英文。"}
        with patch.object(service, "chat", AsyncMock(side_effect=[json.dumps(mixed), chinese["问题表现及描述"]])) as model:
            values, _ = await service.extract_values("translate", DEFAULT_FIELDS, language="zh-CN")
        self.assertEqual(model.await_count, 2)
        self.assertEqual(values["问题表现及描述"], chinese["问题表现及描述"])

    async def test_user_glossary_protects_button_names_during_translation(self):
        from fastapi import HTTPException
        instruction = "术语约定：Back button 翻译为返回键，Play button 翻译为播放键。"
        values = {"预期结果": "Pressing the Back button during playback returns to the details page."}
        with patch.object(service, "chat", AsyncMock(return_value="播放期间按下 FAE_TERM_1 应返回内容详情页。")) as model:
            result = await service.translate_values(values, "zh-CN", instruction)
        self.assertIn("返回键", result["预期结果"])
        self.assertNotIn("播放键", result["预期结果"])
        self.assertIn("FAE_TERM_1", model.await_args.args[1])
        with patch.object(service, "chat", AsyncMock(return_value="播放期间按下播放键应返回内容详情页。")):
            with self.assertRaises(HTTPException):
                await service.translate_values(values, "zh-CN", instruction)
