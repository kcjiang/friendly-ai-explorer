import json
import unittest
from unittest.mock import patch

import httpx

from app.i18n import LanguageMiddleware, language_instruction, message, message_details, output_locale


class LanguageTests(unittest.IsolatedAsyncioTestCase):
    async def test_language_is_request_scoped_and_survives_streaming(self):
        async def endpoint(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": output_locale.get().encode()})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=LanguageMiddleware(endpoint)), base_url="http://test") as client:
            self.assertEqual((await client.get("/", headers={"X-FAE-Locale": "zh-CN"})).text, "zh-CN")
            self.assertEqual((await client.get("/", headers={"X-FAE-Locale": "zh-TW"})).text, "en")
            self.assertEqual((await client.get("/")).text, "en")
        self.assertEqual(output_locale.get(), "en")

    async def test_todo_cache_is_partitioned_by_output_language(self):
        from app.ai import router
        router._todo_cache.clear()
        calls = []
        async def resolve(task): return ([], None, None)
        async def stream(*args, **kwargs):
            calls.append(output_locale.get())
            yield json.dumps([{"task": output_locale.get(), "priority": "major"}])
        with patch.object(router, "resolve", resolve), patch.object(router, "stream", stream):
            for locale in ("en", "zh-CN", "en"):
                token = output_locale.set(locale)
                try:
                    result = json.loads(await router.chat("todo", "same tickets"))
                    self.assertEqual(result[0]["task"], locale)
                finally:
                    output_locale.reset(token)
        self.assertEqual(calls, ["en", "zh-CN"])
        router._todo_cache.clear()

    def test_durable_message_preserves_code_and_parameters(self):
        stored = message("errors.conflict", revision=3)
        self.assertEqual(message_details(stored), {"code": "errors.conflict", "params": {"revision": 3}})
        self.assertEqual(message_details("Value error, " + stored)["code"], "errors.conflict")
        self.assertIsNone(message_details("ordinary business text"))

    def test_generation_instruction_keeps_machine_values_stable(self):
        self.assertIn("Simplified Chinese", language_instruction("zh-CN"))
        self.assertIn("English", language_instruction("zh-TW"))
        self.assertIn("JSON property names and enum values unchanged", language_instruction("en"))
