"""Deterministic adapter/routing tests: no real provider requests or database writes."""

import asyncio
import json
import unittest
from dataclasses import replace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx

from app.ai import provider_client, router


def provider(protocol="openai", **kwargs):
    fields = dict(
        id=uuid4(),
        name="test",
        protocol=protocol,
        base_url="https://example.test/v1",
        model="qwen3.8-27b",
        api_key_encrypted=provider_client.encrypt_key("sk-test-secret"),
        capability_checks={
            k: {"status": "verified"}
            for k in ("text", "json", "stream", "conversation")
        },
        enabled=True,
        timeout_seconds=5,
        max_output_tokens=128,
        max_concurrency=1,
    )
    fields.update(kwargs)
    return router.Provider(**fields)


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.real_client = httpx.AsyncClient

    async def test_runtime_rejects_unverified_model_before_network_call(self):
        item = provider(capability_checks={})
        with (
            patch.object(router, "generate") as upstream,
            patch.object(router, "record_call", AsyncMock()),
        ):
            with self.assertRaisesRegex(
                provider_client.AIError, "errors.capabilityMissing"
            ):
                _ = [
                    chunk
                    async for chunk in router.stream(
                        "todo", "test", plan=([item], 5, 128)
                    )
                ]
            upstream.assert_not_called()

    async def collect(self, item, handler, **kwargs):
        def client(**options):
            return self.real_client(transport=httpx.MockTransport(handler), **options)

        with patch.object(provider_client.httpx, "AsyncClient", side_effect=client):
            return [s async for s in provider_client.generate(item, "你好", **kwargs)]

    async def test_openai_request_and_usage(self):
        def handler(request):
            self.assertEqual(
                str(request.url), "https://example.test/v1/chat/completions"
            )
            self.assertEqual(request.headers["Authorization"], "Bearer sk-test-secret")
            body = json.loads(request.content)
            self.assertEqual(body["model"], "qwen3.8-27b")
            self.assertEqual(body["max_tokens"], 128)
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": "你好"}, "finish_reason": "stop"}
                    ],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 2},
                },
            )

        usage = {}
        self.assertEqual(await self.collect(provider(), handler, usage=usage), ["你好"])
        self.assertEqual((usage["input_tokens"], usage["output_tokens"]), (10, 2))
        self.assertEqual(usage["diagnostics"]["finish_reason"], "stop")

    async def test_official_openai_token_parameter(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertEqual(body["max_completion_tokens"], 128)
            self.assertNotIn("max_tokens", body)
            return httpx.Response(
                200, json={"choices": [{"message": {"content": "OK"}}]}
            )

        await self.collect(
            provider(
                base_url="https://api.openai.com/v1",
                token_parameter="max_completion_tokens",
            ),
            handler,
        )

    async def test_responses_payload_and_stream(self):
        def handler(request):
            self.assertTrue(request.url.path.endswith("/responses"))
            body = json.loads(request.content)
            self.assertFalse(body["store"])
            self.assertEqual(body["input"][-1]["content"], "你好")
            self.assertNotIn("chat_template_kwargs", body)
            if body["stream"]:
                events = [
                    {"type": "response.output_text.delta", "delta": "OK"},
                    {
                        "type": "response.completed",
                        "response": {
                            "status": "completed",
                            "usage": {"input_tokens": 2, "output_tokens": 1},
                        },
                    },
                ]
                return httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    text="".join("data: " + json.dumps(e) + "\n\n" for e in events),
                )
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output": [
                        {
                            "type": "message",
                            "content": [{"type": "output_text", "text": "OK"}],
                        }
                    ],
                },
            )

        for streaming in (False, True):
            self.assertEqual(
                await self.collect(provider("responses"), handler, stream=streaming),
                ["OK"],
            )

    async def test_provider_brand_does_not_inject_qwen_options(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertNotIn("chat_template_kwargs", body)
            self.assertEqual(body["max_completion_tokens"], 128)
            self.assertNotIn("authorization", request.headers)
            return httpx.Response(
                200, json={"choices": [{"message": {"content": "OK"}}]}
            )

        await self.collect(
            provider(
                model="deepseek-chat",
                auth_required=False,
                api_key_encrypted=None,
                token_parameter="max_completion_tokens",
            ),
            handler,
        )

    async def test_multi_turn_roles_reach_both_provider_protocols(self):
        history = [
            {"role": "user", "content": "previous question"},
            {"role": "assistant", "content": "previous answer"},
        ]

        def openai_handler(request):
            messages = json.loads(request.content)["messages"]
            self.assertEqual(messages[:2], history)
            self.assertTrue(messages[-1]["content"].startswith("你好"))
            return httpx.Response(
                200, json={"choices": [{"message": {"content": "OK"}}]}
            )

        await self.collect(
            provider(model="Qwen3-0.6B"), openai_handler, history=history
        )
        self.assertEqual(history[0]["content"], "previous question")

        def gemini_handler(request):
            contents = json.loads(request.content)["contents"]
            self.assertEqual(
                [turn["role"] for turn in contents], ["user", "model", "user"]
            )
            self.assertEqual(contents[1]["parts"][0]["text"], "previous answer")
            return httpx.Response(
                200, json={"candidates": [{"content": {"parts": [{"text": "OK"}]}}]}
            )

        await self.collect(
            provider("gemini", model="gemini-2.5-flash"),
            gemini_handler,
            history=history,
        )

    async def test_gemini_native_and_usage(self):
        def handler(request):
            self.assertEqual(request.headers["x-goog-api-key"], "sk-test-secret")
            self.assertTrue(
                request.url.path.endswith("/models/gemini-2.5-flash:generateContent")
            )
            self.assertEqual(
                json.loads(request.content)["generationConfig"]["maxOutputTokens"], 128
            )
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {"text": "私有推理", "thought": True},
                                    {"text": "回答"},
                                ]
                            },
                            "finishReason": "STOP",
                        }
                    ],
                    "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 1},
                },
            )

        usage = {}
        result = await self.collect(
            provider("gemini", model="models/gemini-2.5-flash"), handler, usage=usage
        )
        self.assertEqual(result, ["回答"])
        self.assertEqual(usage["output_tokens"], 1)

    async def test_ticket_analysis_auto_thinking_preserves_explicit_opt_in(self):
        for thinking, task, disabled in (
            ("auto", "ticket_analysis", True),
            ("on", "ticket_analysis", False),
            ("auto", "rag_chat", False),
        ):

            def handler(request):
                config = json.loads(request.content)["generationConfig"]
                self.assertEqual(
                    config.get("thinkingConfig") == {"thinkingBudget": 0}, disabled
                )
                return httpx.Response(
                    200,
                    json={
                        "candidates": [
                            {
                                "finishReason": "STOP",
                                "content": {"parts": [{"text": "完整分析"}]},
                            }
                        ]
                    },
                )

            self.assertEqual(
                await self.collect(
                    provider(
                        "gemini", model="gemini-2.5-flash", thinking_mode=thinking
                    ),
                    handler,
                    task=task,
                ),
                ["完整分析"],
            )

    async def test_gemini_truncation_records_reasoning_usage_without_accepting_partial_answer(
        self,
    ):
        usage = {}
        response = {
            "candidates": [
                {
                    "finishReason": "MAX_TOKENS",
                    "content": {"parts": [{"text": "partial"}]},
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 874,
                "candidatesTokenCount": 62,
                "thoughtsTokenCount": 1474,
                "totalTokenCount": 2410,
            },
        }
        with self.assertRaises(provider_client.AIError) as raised:
            await self.collect(
                provider("gemini"),
                lambda _: httpx.Response(200, json=response),
                usage=usage,
            )
        self.assertEqual(raised.exception.kind, "truncated")
        self.assertEqual(usage["diagnostics"]["reasoning_tokens"], 1474)
        self.assertEqual(usage["diagnostics"]["total_tokens"], 2410)

    async def test_stream_and_usage(self):
        events = [
            {"choices": [{"delta": {"content": "你好\n"}}]},
            {"choices": [{"delta": {"content": "世界"}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 2, "completion_tokens": 3}},
        ]
        data = (
            "".join("data: " + json.dumps(e) + "\n\n" for e in events)
            + "data: [DONE]\n\n"
        )
        usage = {}
        result = await self.collect(
            provider(),
            lambda _: httpx.Response(
                200, text=data, headers={"Content-Type": "text/event-stream"}
            ),
            stream=True,
            usage=usage,
        )
        self.assertEqual(result, ["你好\n", "世界"])
        self.assertEqual(usage["output_tokens"], 3)

    async def test_gemini_stream(self):
        data = 'data: {"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}\n\n'
        self.assertEqual(
            await self.collect(
                provider("gemini"),
                lambda _: httpx.Response(
                    200, text=data, headers={"Content-Type": "text/event-stream"}
                ),
                stream=True,
            ),
            ["OK"],
        )

    async def test_incomplete_stream_fails(self):
        with self.assertRaisesRegex(
            provider_client.AIError, "errors.theStreamEndedBeforeCompletion"
        ):
            await self.collect(
                provider(),
                lambda _: httpx.Response(
                    200,
                    text='data: {"choices":[{"delta":{"content":"半截"}}]}\n\n',
                    headers={"Content-Type": "text/event-stream"},
                ),
                stream=True,
            )

    async def test_status_errors_are_safe_and_classified(self):
        for status in (400, 401, 403, 404, 429, 500):
            with self.subTest(status=status):
                with self.assertRaises(provider_client.AIError) as raised:
                    await self.collect(
                        provider(),
                        lambda _: httpx.Response(
                            status, text="sk-test-secret private provider body"
                        ),
                    )
                self.assertNotIn("sk-test-secret", str(raised.exception))
                self.assertNotIn("private", str(raised.exception))
                self.assertEqual(raised.exception.retryable, status in (429, 500))

    async def test_network_timeout_is_safe(self):
        def handler(request):
            raise httpx.ReadTimeout("sk-test-secret", request=request)

        with self.assertRaisesRegex(
            provider_client.AIError, "errors.aiRequestTimedOut"
        ):
            await self.collect(provider(), handler)

    async def test_truncated_and_malformed_responses_fail(self):
        for response in (
            httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": "half"}, "finish_reason": "length"}
                    ]
                },
            ),
            httpx.Response(200, text="<html>bad</html>"),
        ):
            with self.assertRaises(provider_client.AIError):
                await self.collect(provider(), lambda _: response)

    async def test_concurrency_limit_and_release(self):
        p = provider()
        async with provider_client.provider_slot(p):
            with self.assertRaises(provider_client.AIError):
                async with provider_client.provider_slot(p):
                    self.fail("second request must be rejected")
        async with provider_client.provider_slot(p):
            pass

    async def test_classic_qwen_disables_thinking_and_requests_json_schema(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertEqual(body["chat_template_kwargs"], {"enable_thinking": False})
            self.assertIn("/no_think", body["messages"][0]["content"])
            self.assertEqual(body["response_format"]["type"], "json_schema")
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": '<think>不要展示</think>{"todos":[{"task":"检查","priority":"major"}]}'
                            }
                        }
                    ]
                },
            )

        result = await self.collect(provider(model="qwen3-0.6b"), handler, task="todo")
        self.assertTrue(result[0].startswith('{"todos"'))
        self.assertNotIn("不要展示", result[0])

    async def test_schema_negotiation_downgrades_only_in_auto_mode(self):
        modes = []

        def handler(request):
            body = json.loads(request.content)
            mode = body.get("response_format", {}).get("type", "off")
            modes.append(mode)
            if mode != "off":
                return httpx.Response(
                    400, json={"error": {"message": "unsupported response_format"}}
                )
            return httpx.Response(
                200, json={"choices": [{"message": {"content": '{"ok":true}'}}]}
            )

        usage = {}
        await self.collect(provider(), handler, task="test_json", usage=usage)
        self.assertEqual(modes, ["json_schema", "json_object", "off"])
        self.assertEqual(usage["diagnostics"]["capability_downgrades"], 2)
        modes.clear()
        with self.assertRaises(provider_client.AIError):
            await self.collect(
                provider(structured_output="schema"), handler, task="test_json"
            )
        self.assertEqual(modes, ["json_schema"])

    async def test_parameter_error_unrelated_to_json_is_not_downgraded(self):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(
                400, json={"error": {"message": "maximum context length exceeded"}}
            )

        with self.assertRaises(provider_client.AIError):
            await self.collect(provider(), handler, task="todo")
        self.assertEqual(len(calls), 1)

    async def test_split_thinking_tags_are_hidden_from_stream(self):
        events = [
            {"choices": [{"delta": {"content": chunk}}]}
            for chunk in ("<thi", "nk>私有思考</thi", "nk>最终", "回答")
        ]
        events.append({"choices": [{"delta": {}, "finish_reason": "stop"}]})
        data = (
            "".join("data: " + json.dumps(e) + "\n\n" for e in events)
            + "data: [DONE]\n\n"
        )
        result = await self.collect(
            provider(),
            lambda _: httpx.Response(
                200, text=data, headers={"Content-Type": "text/event-stream"}
            ),
            stream=True,
        )
        self.assertEqual("".join(result), "最终回答")

    async def test_reasoning_only_response_is_identified(self):
        with self.assertRaises(provider_client.AIError) as raised:
            await self.collect(
                provider(),
                lambda _: httpx.Response(
                    200,
                    json={
                        "choices": [
                            {
                                "message": {
                                    "content": "",
                                    "reasoning_content": "thinking",
                                }
                            }
                        ]
                    },
                ),
            )
        self.assertEqual(raised.exception.kind, "reasoning_only")

    async def test_embeddings_use_bounded_async_request(self):
        from app.ai.embedding_config import EmbeddingConfig
        from app.ai.embeddings import embed_text

        response = httpx.Response(
            200, json={"data": [{"index": 0, "embedding": [1.0] + [0.0] * 767}]}
        )
        config = EmbeddingConfig(
            protocol="openai", base_url="http://embedding.test/v1", model="local"
        )
        with patch(
            "httpx.AsyncClient.post", AsyncMock(return_value=response)
        ) as embedded:
            self.assertEqual(
                await embed_text("query", task_type="retrieval_query", config=config),
                [1.0] + [0.0] * 767,
            )
        self.assertEqual(
            embedded.await_args.args[0], "http://embedding.test/v1/embeddings"
        )
        self.assertEqual(embedded.await_args.kwargs["json"]["input"], ["query"])


class RoutingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        router._todo_cache.clear()
        self.first, self.second = provider(), provider(name="backup")
        self.resolve = patch.object(
            router,
            "resolve",
            AsyncMock(return_value=([self.first, self.second], None, None)),
        )
        self.record = patch.object(router, "record_call", AsyncMock())
        self.resolve_mock = self.resolve.start()
        self.record_mock = self.record.start()
        self.addCleanup(self.resolve.stop)
        self.addCleanup(self.record.stop)

    async def test_analysis_uses_configured_budget_or_explicit_route_override(self):
        for limit, override, expected in (
            (2048, None, 2048),
            (4096, None, 4096),
            (4096, 1024, 1024),
        ):
            item = replace(self.first, max_output_tokens=limit)

            async def generated(p, prompt, **kwargs):
                self.assertEqual(kwargs["max_tokens"], expected)
                yield "完整分析"

            with patch.object(router, "generate", generated):
                result = [
                    chunk
                    async for chunk in router.stream(
                        "ticket_analysis",
                        "test",
                        streaming=False,
                        plan=([item], 5, override),
                    )
                ]
            self.assertEqual(result, ["完整分析"])

    async def test_unverified_primary_can_use_verified_backup(self):
        async def generated(p, *args, **kwargs):
            self.assertEqual(p.id, self.second.id)
            yield "backup"

        with patch.object(router, "generate", generated):
            result = [
                chunk
                async for chunk in router.stream(
                    "ticket_analysis",
                    "test",
                    streaming=False,
                    plan=(
                        [replace(self.first, capability_checks={}), self.second],
                        5,
                        None,
                    ),
                )
            ]
        self.assertEqual(result, ["backup"])

    async def test_retryable_failure_uses_backup_and_records_both(self):
        async def generate(p, *args, **kwargs):
            if p.id == self.first.id:
                raise provider_client.AIError("超时", retryable=True)
            yield "备用回答"

        with patch.object(router, "generate", generate):
            self.assertEqual(await router.chat("ticket_analysis", "prompt"), "备用回答")
        self.assertEqual(self.record_mock.await_count, 2)
        self.assertFalse(self.record_mock.await_args_list[0].args[2])
        self.assertTrue(self.record_mock.await_args_list[1].args[3])

    async def test_auth_failure_does_not_use_backup(self):
        calls = []

        async def generate(p, *args, **kwargs):
            calls.append(p.id)
            raise provider_client.AIError("API Key 无效")
            yield

        with (
            patch.object(router, "generate", generate),
            self.assertRaises(provider_client.AIError),
        ):
            await router.chat("ticket_analysis", "prompt")
        self.assertEqual(calls, [self.first.id])

    async def test_stream_never_switches_after_first_chunk(self):
        calls, chunks = [], []

        async def generate(p, *args, **kwargs):
            calls.append(p.id)
            yield "开始回答"
            raise provider_client.AIError("超时", retryable=True)

        with (
            patch.object(router, "generate", generate),
            self.assertRaises(provider_client.AIError),
        ):
            async for chunk in router.stream("rag_chat", "prompt"):
                chunks.append(chunk)
        self.assertEqual(chunks, ["开始回答"])
        self.assertEqual(calls, [self.first.id])

    async def test_invalid_todo_falls_back_and_cache_tracks_configuration(self):
        calls = []

        async def generate(p, *args, **kwargs):
            calls.append(p.id)
            yield (
                '[{"task":"检查工单","priority":"major"}]'
                if p.id == self.second.id
                else "invalid json"
            )

        with patch.object(router, "generate", generate):
            result = await router.chat("todo", "today")
            self.assertEqual(await router.chat("todo", "today"), result)
            self.assertEqual(len(calls), 3)  # one structural repair, then backup
            self.resolve_mock.return_value = (
                [replace(self.second, max_output_tokens=512)],
                None,
                None,
            )
            await router.chat("todo", "today")
            self.assertEqual(len(calls), 4)

    async def test_disabled_service_falls_back(self):
        self.resolve_mock.return_value = (
            [replace(self.first, enabled=False), self.second],
            None,
            None,
        )

        async def generate(p, *args, **kwargs):
            self.assertEqual(p.id, self.second.id)
            yield "OK"

        with patch.object(router, "generate", generate):
            self.assertEqual(await router.chat("ticket_analysis", "prompt"), "OK")

    def test_structured_output_validation(self):
        self.assertEqual(
            json.loads(
                router.validate_result(
                    "todo", '```json\n[{"task":"检查","priority":"major"}]\n```'
                )
            )[0]["task"],
            "检查",
        )
        for task, raw in (("todo", "[]"), ("todo", '[{"task":"x","priority":"bad"}]')):
            with (
                self.subTest(task=task, raw=raw),
                self.assertRaises(provider_client.AIError),
            ):
                router.validate_result(task, raw)

    def test_extract_final_json_and_normalize_known_priorities(self):
        raw = '<think>这里包含一个不应读取的例子 [{"task":"wrong"}]</think>最终结果：```json\n{"todos":[{"title":"检查网络","priority":"medium"}]}\n```'
        self.assertEqual(
            json.loads(router.validate_result("todo", raw)),
            [{"task": "检查网络", "priority": "major"}],
        )
        self.assertEqual(
            router.parse_json('{"task":"literal <think>"}')["task"], "literal <think>"
        )
        for raw in (
            '[{"task":"broken"}',
            '{"a":1} {"b":2}',
            '<think>not finished {"ok":true}',
        ):
            with self.assertRaises(provider_client.AIError):
                router.parse_json(raw)

    async def test_transient_failure_retries_with_remaining_budget(self):
        calls = []

        async def generate(p, *args, **kwargs):
            calls.append(kwargs["timeout"])
            if len(calls) == 1:
                raise provider_client.AIError(
                    "暂时不可用",
                    retryable=True,
                    kind="upstream_unavailable",
                    details={"http_status": 503},
                )
            yield "恢复正常"

        with patch.object(router, "generate", generate):
            self.assertEqual(await router.chat("ticket_analysis", "retry"), "恢复正常")
        self.assertEqual(len(calls), 2)
        self.assertLess(calls[1], calls[0])
        self.assertLessEqual(calls[0], self.first.timeout_seconds)

    async def test_zero_retry_and_structural_repair_limits(self):
        self.resolve_mock.return_value = (
            [replace(self.first, retry_count=0)],
            None,
            None,
        )
        calls = []

        async def unavailable(p, *args, **kwargs):
            calls.append(1)
            raise provider_client.AIError(
                "暂时不可用", retryable=True, kind="upstream_unavailable"
            )
            yield

        with (
            patch.object(router, "generate", unavailable),
            self.assertRaises(provider_client.AIError),
        ):
            await router.chat("ticket_analysis", "retry")
        self.assertEqual(len(calls), 1)
        calls.clear()

        async def malformed(p, *args, **kwargs):
            calls.append(1)
            yield "not json"

        with (
            patch.object(router, "generate", malformed),
            self.assertRaises(provider_client.AIError),
        ):
            await router.chat("todo", "repair")
        self.assertEqual(len(calls), 2)  # one targeted repair, no endless loop

    async def test_concurrent_todo_requests_share_one_generation(self):
        calls = []

        async def generate(p, *args, **kwargs):
            calls.append(1)
            await asyncio.sleep(0.02)
            yield '{"todos":[{"task":"检查工单","priority":"major"}]}'

        with patch.object(router, "generate", generate):
            results = await asyncio.gather(
                router.chat("todo", "same prompt"), router.chat("todo", "same prompt")
            )
        self.assertEqual(results[0], results[1])
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
