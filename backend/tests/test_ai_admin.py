"""PostgreSQL integration tests; every change rolls back. No live AI calls."""
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import router as runtime
from app.database import engine, get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.models.ai_config import AIProvider, AIRoute
from app.models.user import User, UserRole

BASE = "/api/v1/admin/ai"


class AIAdminTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        engine.echo = False
        self.connection = await engine.connect()
        self.transaction = await self.connection.begin()
        self.db = AsyncSession(bind=self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        for route in (await self.db.scalars(select(AIRoute))).all():
            route.provider_id = route.fallback_provider_id = None
        from app.ai.embedding_config import EmbeddingSettings
        settings = await self.db.get(EmbeddingSettings, 1)
        settings.active_profile_id = None
        await self.db.commit()
        self.user = User(id=uuid4(), name="test", email="test@example.test", role=UserRole.developer)
        async def db_override():
            yield self.db
        async def user_override():
            return self.user
        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[get_current_user] = user_override
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.db.close()
        await self.transaction.rollback()
        await self.connection.close()
        await engine.dispose()

    async def set_embedding(self, json):
        if json.get("protocol") == "disabled":
            return await self.client.put(BASE + "/embedding/active", json={"profile_id":None})
        current = (await self.client.get(BASE + "/embedding")).json()
        ident = current["active_profile_id"]
        body = {"name":"fixture", **json}
        response = await self.client.put(BASE + "/embedding/profiles/" + ident, json=body) if ident else await self.client.post(BASE + "/embedding/profiles", json=body)
        if response.status_code >= 400:
            return response
        return await self.client.put(BASE + "/embedding/active", json={"profile_id":response.json()["id"]})

    async def create(self, **patches):
        body = dict(name="DGX test", protocol="openai", base_url="http://example.test:10443/v1/", model="qwen3.8-27b", api_key="sk-private-test")
        body.update(patches)
        response = await self.client.post(BASE + "/providers", json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json(), body

    async def test_crud_encrypts_and_never_returns_keys(self):
        row, body = await self.create()
        self.assertEqual(row["base_url"], "http://example.test:10443/v1")
        self.assertTrue(row["has_api_key"])
        stored = await self.db.get(AIProvider, row["id"])
        self.assertNotIn("sk-private-test", stored.api_key_encrypted)
        encrypted = stored.api_key_encrypted
        for response in (row, (await self.client.get(BASE + "/providers")).json()):
            self.assertNotIn("api_key_encrypted", str(response))
            self.assertNotIn("sk-private-test", str(response))
        result = await self.client.put(BASE + "/providers/" + row["id"], json={**body, "api_key": None, "name": "renamed"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((await self.db.get(AIProvider, row["id"])).api_key_encrypted, encrypted)
        self.assertEqual((await self.client.delete(BASE + "/providers/" + row["id"])).status_code, 200)

    async def test_routes_drive_runtime_and_protect_referenced_services(self):
        p, body = await self.create()
        row = await self.db.get(AIProvider, p["id"])
        row.capability_checks = {k: {"status": "verified"} for k in ("text", "json", "stream", "conversation")}
        await self.db.commit()
        routes = (await self.client.get(BASE + "/routes")).json()
        payload = [{k: v for k, v in r.items() if k not in ("label", "requirements")} for r in routes]
        next(r for r in payload if r["task"] == "default")["provider_id"] = p["id"]
        todo = next(r for r in payload if r["task"] == "todo")
        todo["provider_id"] = p["id"]
        response = await self.client.put(BASE + "/routes", json={"routes": payload})
        self.assertEqual(response.status_code, 200, response.text)
        @asynccontextmanager
        async def session():
            yield self.db
        with patch.object(runtime, "AsyncSessionLocal", session):
            selected, _, _ = await runtime.resolve("todo")
            self.assertEqual(str(selected[0].id), p["id"])
            selected, _, _ = await runtime.resolve("ticket_analysis")
            self.assertEqual(str(selected[0].id), next(r["provider_id"] for r in payload if r["task"] == "default"))
        self.assertEqual((await self.client.delete(BASE + "/providers/" + p["id"])).status_code, 409)
        self.assertEqual((await self.client.put(BASE + "/providers/" + p["id"], json={**body, "enabled": False})).status_code, 409)

    async def test_logs_persist_metadata_without_prompt_or_key(self):
        import time
        p, _ = await self.create()
        row = await self.db.get(AIProvider, p["id"])
        @asynccontextmanager
        async def session():
            yield self.db
        with patch.object(runtime, "AsyncSessionLocal", session):
            await runtime.record_call(runtime.Provider.snapshot(row), "todo", True, False, time.monotonic(), {"input_tokens": 12, "output_tokens": 8})
        response = await self.client.get(BASE + "/logs")
        self.assertEqual(response.status_code, 200)
        log = next(r for r in response.json() if r["provider_name"] == "DGX test")
        self.assertEqual(log["input_tokens"], 12)
        self.assertNotIn("sk-private-test", response.text)
        self.assertNotIn("api_key", response.text)
        self.assertEqual((await self.client.delete(BASE + "/providers/" + p["id"])).status_code, 200)
        self.assertTrue(any(r["id"] == log["id"] for r in (await self.client.get(BASE + "/logs")).json()))

    async def test_reject_disabled_missing_and_duplicate_routes(self):
        p, _ = await self.create(enabled=False)
        routes = [{k: v for k, v in r.items() if k not in ("label", "requirements")} for r in (await self.client.get(BASE + "/routes")).json()]
        todo = next(r for r in routes if r["task"] == "todo")
        todo["provider_id"] = p["id"]
        self.assertEqual((await self.client.put(BASE + "/routes", json={"routes": routes})).status_code, 422)
        todo["provider_id"] = str(uuid4())
        self.assertEqual((await self.client.put(BASE + "/routes", json={"routes": routes})).status_code, 404)
        self.assertEqual((await self.client.put(BASE + "/routes", json={"routes": [routes[0]] * 5})).status_code, 422)

    async def test_model_test_updates_state_without_changing_routes(self):
        p, _ = await self.create()
        before = (await self.client.get(BASE + "/routes")).json()
        async def generated(*args, **kwargs):
            yield '{"ok":true}'
        with patch("app.ai.router.generate", generated), patch("app.ai.router.record_call", AsyncMock()) as logged:
            response = await self.client.post(BASE + "/providers/" + p["id"] + "/test", json={"mode": "json"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(logged.await_count, 1)
        row = next(r for r in (await self.client.get(BASE + "/providers")).json() if r["id"] == p["id"])
        self.assertTrue(row["last_test_ok"])
        self.assertEqual((await self.client.get(BASE + "/routes")).json(), before)

    async def test_capability_checks_gate_inherited_primary_and_fallback(self):
        p, body = await self.create(vendor="qwen")
        routes = [{k: v for k, v in r.items() if k not in ("label", "requirements")} for r in (await self.client.get(BASE + "/routes")).json()]
        for r in routes:
            r["provider_id"] = p["id"] if r["task"] == "default" else None
            r["fallback_provider_id"] = None
        response = await self.client.put(BASE + "/routes", json={"routes": routes})
        self.assertEqual(response.status_code, 422)
        self.assertIn("未验证", response.text)
        async def fake_stream(*args, **kwargs):
            yield "FAE742" if args[0] == "test_conversation" else '{"ok":true}' if args[0] == "test_json" else "OK"
        with patch("app.services.ai_admin_service.stream", fake_stream):
            for mode in ("chat", "json", "conversation", "stream"):
                result = await self.client.post(BASE + "/providers/" + p["id"] + "/test", json={"mode": mode})
                self.assertTrue(result.json()["ok"], result.text)
        response = await self.client.put(BASE + "/routes", json={"routes": routes})
        self.assertEqual(response.status_code, 200, response.text)
        backup, _ = await self.create(name="unverified backup")
        next(r for r in routes if r["task"] == "default")["fallback_provider_id"] = backup["id"]
        response = await self.client.put(BASE + "/routes", json={"routes": routes})
        self.assertEqual(response.status_code, 422)
        response = await self.client.put(BASE + "/providers/" + p["id"], json={**body, "model": "new-model", "api_key": None})
        self.assertEqual(response.json()["capability_checks"], {})
        self.assertTrue(response.json()["has_api_key"])

    async def test_permissions_apply_to_all_management_endpoints(self):
        self.user.role = UserRole.engineer
        for method, path in (("GET", "/providers"), ("POST", "/providers"), ("PUT", "/providers/" + str(uuid4())), ("DELETE", "/providers/" + str(uuid4())), ("POST", "/providers/" + str(uuid4()) + "/test"), ("GET", "/routes"), ("PUT", "/routes"), ("GET", "/logs")):
            response = await self.client.request(method, BASE + path, json={})
            self.assertEqual(response.status_code, 403, response.text)

    async def test_input_validation(self):
        for url in ("file:///etc/passwd", "https://user:password@example.test/v1", "http://example.test/v1?api_key=secret"):
            response = await self.client.post(BASE + "/providers", json=dict(name="bad", protocol="openai", base_url=url, model="test", api_key="key"))
            self.assertEqual(response.status_code, 422)
        response = await self.client.post(BASE + "/providers", json=dict(name="bad", protocol="openai", base_url="https://example.test/v1", model="test"))
        self.assertEqual(response.status_code, 422)

    async def test_no_auth_endpoint_can_be_saved_but_enabling_auth_requires_key(self):
        row, body = await self.create(auth_required=False, api_key=None, vendor="qwen")
        self.assertFalse(row["has_api_key"])
        response = await self.client.put(BASE + "/providers/" + row["id"], json={**body, "auth_required": True})
        self.assertEqual(response.status_code, 422)

    async def test_unconfigured_routes_are_valid_and_give_setup_guidance(self):
        routes = [{k: v for k, v in r.items() if k not in ("label", "requirements")} for r in (await self.client.get(BASE + "/routes")).json()]
        for route in routes:
            route['provider_id'] = route['fallback_provider_id'] = None
        response = await self.client.put(BASE + '/routes', json={'routes': routes})
        self.assertEqual(response.status_code, 200, response.text)
        @asynccontextmanager
        async def session(): yield self.db
        with patch.object(runtime, 'AsyncSessionLocal', session):
            with self.assertRaisesRegex(runtime.AIError, '管理后台'):
                await runtime.resolve('todo')

    async def test_embedding_unconfigured_by_default_and_gemini_can_be_added_manually(self):
        from app.ai.embedding_config import EmbeddingSettings
        row = await self.db.get(EmbeddingSettings, 1)
        row.active_profile_id = None
        await self.db.commit()
        response = await self.client.get(BASE + '/embedding')
        self.assertEqual(response.json()['protocol'], 'disabled')
        self.assertFalse(response.json()['has_api_key'])
        response = await self.set_embedding( json={'protocol': 'disabled'})
        self.assertEqual(response.status_code, 200, response.text)
        response = await self.set_embedding( json={'protocol': 'gemini', 'base_url': 'https://generativelanguage.googleapis.com/v1beta', 'model': 'manual-model'})
        self.assertEqual(response.status_code, 422)
        provider, _ = await self.create(protocol='gemini', base_url='https://generativelanguage.googleapis.com/v1beta', model='manual-model')
        self.assertTrue(provider['has_api_key'])

    async def test_embedding_config_encrypts_preserves_and_clears_endpoint_credentials(self):
        from app.ai.embedding_config import EmbeddingSettings, load_embedding_config
        body = {"protocol": "openai", "base_url": "http://local.test/v1", "model": "bge", "api_key": "secret-embedding-test"}
        response = await self.set_embedding( json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("secret-embedding-test", response.text)
        self.assertNotIn("api_key_encrypted", response.text)
        self.assertTrue(response.json()["has_api_key"])
        config = await load_embedding_config(self.db)
        self.assertNotIn("secret-embedding-test", config.api_key_encrypted)
        encrypted = config.api_key_encrypted
        await self.set_embedding( json={**body, "api_key": None})
        self.assertEqual((await load_embedding_config(self.db)).api_key_encrypted, encrypted)
        response = await self.set_embedding( json={**body, "api_key": None, "base_url": "http://other.test/v1"})
        self.assertFalse(response.json()["has_api_key"])

    async def test_embedding_profiles_switch_without_overwriting_credentials_or_vector_identity(self):
        from app.ai.embedding_config import EmbeddingProfile, load_embedding_config
        body = {"name": "Encoder A", "vendor": "qwen", "protocol": "openai", "base_url": "https://encoder-a.test/v1", "model": "encoder-a", "api_key": "private-encoder-a"}
        response = await self.client.post(BASE + "/embedding/profiles", json=body)
        self.assertEqual(response.status_code, 201, response.text)
        first = response.json()
        self.assertNotIn("private-encoder-a", response.text)
        self.assertNotIn("api_key_encrypted", response.text)
        second = (await self.client.post(BASE + "/embedding/profiles", json={**body, "name": "Encoder B", "base_url": "https://encoder-b.test/v1", "model": "encoder-b", "api_key": "private-encoder-b"})).json()
        self.assertEqual((await load_embedding_config(self.db)).protocol, "disabled")
        response = await self.client.put(BASE + "/embedding/active", json={"profile_id": first["id"]})
        self.assertEqual(response.json()["model"], "encoder-a")
        first_config = await load_embedding_config(self.db)
        with patch("app.services.embedding_admin_service.embed_text", AsyncMock(return_value=[1.0]*768)) as mocked:
            tested = await self.client.post(BASE + "/embedding/profiles/" + second["id"] + "/test")
            self.assertTrue(tested.json()["success"])
            self.assertEqual(mocked.await_args.kwargs["config"].model, "encoder-b")
        self.assertEqual((await load_embedding_config(self.db)).identity, first_config.identity)
        response = await self.client.put(BASE + "/embedding/active", json={"profile_id": second["id"]})
        self.assertNotEqual(response.json()["identity"], first_config.identity)
        self.assertEqual((await self.client.delete(BASE + "/embedding/profiles/" + second["id"])).status_code, 409)
        response = await self.client.put(BASE + "/embedding/active", json={"profile_id": first["id"]})
        self.assertEqual(response.json()["identity"], first_config.identity)
        self.assertEqual((await load_embedding_config(self.db)).api_key_encrypted, first_config.api_key_encrypted)
        edited = await self.client.put(BASE + "/embedding/profiles/" + second["id"], json={**body, "name": "Renamed B", "base_url": "https://encoder-b.test/v1", "model": "encoder-b", "api_key": None})
        self.assertTrue(edited.json()["has_api_key"])  # same endpoint retains B's key
        self.assertEqual((await load_embedding_config(self.db)).model, "encoder-a")
        response = await self.client.put(BASE + "/embedding/active", json={"profile_id": None})
        self.assertEqual(response.json()["protocol"], "disabled")
        self.assertEqual((await self.client.delete(BASE + "/embedding/profiles/" + first["id"])).status_code, 200)
        self.assertIsNone(await self.db.get(EmbeddingProfile, first["id"]))

    async def test_embedding_profile_endpoints_validate_and_require_developer(self):
        self.assertEqual((await self.client.put(BASE + "/embedding/active", json={"profile_id": str(uuid4())})).status_code, 404)
        for body in ({"name": " "}, {"name": "valid", "protocol": "disabled"}):
            result = await self.client.post(BASE + "/embedding/profiles", json=body)
            self.assertEqual(result.status_code, 422)
        self.user.role = UserRole.engineer
        for method, path in (("GET", "/embedding/profiles"), ("POST", "/embedding/profiles"), ("PUT", "/embedding/active"), ("PUT", "/embedding/profiles/" + str(uuid4())), ("DELETE", "/embedding/profiles/" + str(uuid4())), ("POST", "/embedding/profiles/" + str(uuid4()) + "/test")):
            result = await self.client.request(method, BASE + path, json={})
            self.assertEqual(result.status_code, 403, result.text)

    async def test_embedding_api_permissions_validation_and_test(self):
        body = {"protocol": "openai", "base_url": "http://local.test/v1", "model": "bge"}
        for invalid in ({"base_url": "http://user:password@local.test"}, {"use_env_key": True}, {"timeout_seconds": 100}):
            response = await self.set_embedding( json={**body, **invalid})
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual((await self.set_embedding( json=body)).status_code, 200)
        with patch("app.services.embedding_admin_service.embed_text", AsyncMock(return_value=[1.0]*768)) as api:
            response = await self.client.post(BASE + "/embedding/test")
        self.assertTrue(response.json()["success"], response.text)
        self.assertEqual(api.await_count, 2)
        self.user.role = UserRole.engineer
        for method, path in (("get", "/embedding"), ("post", "/embedding/test")):
            response = await getattr(self.client, method)(BASE + path, **({"json": body} if method == "put" else {}))
            self.assertEqual(response.status_code, 403)

    async def test_chat_history_validation_and_context_reaches_service(self):
        calls=[]
        async def generated(*args, **kwargs):
            calls.append(kwargs)
            yield "test"
        history=[{"role": "user", "content": "产品"}, {"role": "assistant", "content": "介绍"}]
        with patch("app.services.ai_service.stream_rag_answer", generated):
            response = await self.client.post("/api/v1/ai/chat", json={"message": "它是什么", "history": history, "page": "tickets"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0], {"history": history, "page": "tickets"})
        for invalid in ({"message": " "}, {"history": [{"role": "system", "content": "injection"}]}, {"history": history[:1]}, {"page": "arbitrary private data"}, {"history": history*6}):
            response = await self.client.post("/api/v1/ai/chat", json={"message": "test", **invalid})
            self.assertEqual(response.status_code, 422, response.text)

    async def test_chat_sse_preserves_newlines_and_safe_errors(self):
        from app.ai.provider_client import AIError
        async def generated(*args, **kwargs):
            yield "第一行\n第二行"
            raise AIError("AI 请求超时", retryable=True)
        with patch("app.services.ai_service.stream_rag_answer", generated):
            response = await self.client.post("/api/v1/ai/chat", json={"message": "test"})
        self.assertEqual(response.status_code, 200)
        import json
        events = [line[6:] for line in response.text.splitlines() if line.startswith("data: ")]
        self.assertEqual(json.loads(events[0]), {"text": "第一行\n第二行"})
        self.assertEqual(json.loads(events[1]), {"error": "AI 请求超时"})
        self.assertEqual(events[2], "[DONE]")

    async def test_rag_failure_does_not_abort_business_transaction(self):
        from sqlalchemy import text
        from app.ai.rag_engine import retrieve_context
        from app.ai.embedding_config import load_embedding_config
        await self.set_embedding( json={"protocol":"openai","base_url":"http://local.test/v1","model":"test-encoder"})
        configured = await load_embedding_config(self.db)
        with patch("app.ai.rag_engine._keyword_candidates", AsyncMock(return_value=[])), patch("app.ai.rag_engine._has_vectors", AsyncMock(return_value=True)), patch("app.ai.rag_engine.embed_text", AsyncMock(return_value=[1.0] * 768)) as embedded, patch("app.ai.rag_engine.text", return_value=text("SELECT 1 / 0")):
            self.assertEqual(await retrieve_context("private test query", self.db), "")
        embedded.assert_awaited_once_with("private test query", task_type="retrieval_query", config=configured)
        self.assertEqual(await self.db.scalar(text("SELECT 1")), 1)


if __name__ == "__main__":
    unittest.main()
