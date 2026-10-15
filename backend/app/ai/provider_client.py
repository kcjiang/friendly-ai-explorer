"""HTTP adapters. Never surface provider bodies, URLs or credentials in errors."""
import asyncio
import base64
import hashlib
import json
import re
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from urllib.parse import quote

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.logging_config import register_secret


class AIError(Exception):
    def __init__(self, message: str, retryable: bool = False, *, kind="unknown", details=None):
        super().__init__(message)
        self.retryable = retryable
        self.kind = kind
        self.details = details or {}


def cipher():
    secret = settings.ai_encryption_key or settings.jwt_secret_key
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("fae-ai:" + secret).encode()).digest()))


def encrypt_key(value: str) -> str:
    return cipher().encrypt(value.encode()).decode()


def provider_key(provider) -> str:
    try:
        value = (cipher().decrypt(provider.api_key_encrypted.encode()).decode()
                 if provider.api_key_encrypted else settings.google_api_key if provider.use_env_key else "")
    except InvalidToken:
        raise AIError("密钥无法解密，请重新填写 API Key") from None
    if not value:
        raise AIError("未配置 API Key")
    register_secret(value)
    return value


# Limits are per backend process. Includes tests and streaming calls; no unbounded queue.
_active = defaultdict(int)


@asynccontextmanager
async def provider_slot(provider):
    key = str(provider.id)
    if _active[key] >= provider.max_concurrency:
        raise AIError("服务并发已满，请稍后重试", retryable=True, kind="busy")
    _active[key] += 1
    try:
        yield
    finally:
        _active[key] -= 1
        if not _active[key]:
            _active.pop(key, None)


def status_error(code: int, response=None):
    labels = {400: "请求参数不被模型支持", 401: "API Key 无效", 403: "无权访问模型", 404: "模型或 API 路径不存在", 429: "服务限流或额度不足"}
    details = {"http_status": code}
    message = labels.get(code, f"AI 服务返回 HTTP {code}")
    if response is not None:
        upstream_id = response.headers.get("x-request-id", response.headers.get("request-id", ""))
        if re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", upstream_id):
            details["upstream_request_id"] = upstream_id
        try:
            details["retry_after_seconds"] = min(30, max(0, float(response.headers.get("retry-after", "0"))))
        except ValueError:
            pass
        if response.is_stream_consumed:
            text = response.content[:4096].decode("utf-8", errors="replace").lower()
            # Record a known category instead of an upstream body that may echo inputs.
            if any(word in text for word in ("context length", "context_length", "maximum context", "max_model_len")):
                message = "输入或输出预算超出模型上下文限制，请缩短输入或降低输出上限"
                details["upstream_category"] = "context_limit"
            elif any(word in text for word in ("cuda out of memory", "cuda error: out of memory", "outofmemoryerror")):
                message = "推理服务显存不足，请降低并发或模型资源占用"
                details["upstream_category"] = "out_of_memory"
            elif "chat_template_kwargs" in text or "enable_thinking" in text:
                message = "接口不支持当前思考参数，请切换自动兼容模式或调整网关"
                details["upstream_category"] = "thinking_parameter"
            elif "response_format" in text or "json_schema" in text:
                message = "接口不支持当前结构化输出模式，请使用自动兼容模式"
                details["upstream_category"] = "structured_parameter"
    kind = "rate_limit" if code == 429 else "upstream_unavailable" if code >= 500 else "timeout" if code == 408 else "invalid_parameter" if code in (400, 422) else "auth" if code in (401, 403) else "http_error"
    return AIError(message, code in (408, 429) or code >= 500, kind=kind, details=details)


def parse_payload(data, protocol, usage, streaming):
    diagnostics = usage.setdefault("diagnostics", {})
    if "error" in data:
        raise AIError("AI 服务返回错误事件", retryable=True, kind="upstream_unavailable")
    if protocol == "openai":
        tokens = data.get("usage") or {}
        usage.update(input_tokens=tokens.get("prompt_tokens", usage.get("input_tokens")),
                     output_tokens=tokens.get("completion_tokens", usage.get("output_tokens")))
        choices = data.get("choices") or []
        if not choices:
            return ""
        choice = choices[0]
        if choice.get("finish_reason"):
            diagnostics["finish_reason"] = choice["finish_reason"]
        message = choice.get("delta" if streaming else "message", {})
        reasoning = message.get("reasoning_content") or message.get("reasoning")
        if isinstance(reasoning, str):
            diagnostics["reasoning_chars"] = diagnostics.get("reasoning_chars", 0) + len(reasoning)
        if choice.get("finish_reason") in ("length", "content_filter"):
            raise AIError("模型输出达到长度上限" if choice["finish_reason"] == "length" else "模型输出被安全过滤", retryable=choice["finish_reason"] == "length", kind="truncated" if choice["finish_reason"] == "length" else "filtered")
        content = message.get("content")
        return content if isinstance(content, str) else ""
    tokens = data.get("usageMetadata") or {}
    usage.update(input_tokens=tokens.get("promptTokenCount", usage.get("input_tokens")),
                 output_tokens=tokens.get("candidatesTokenCount", usage.get("output_tokens")))
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    candidate = candidates[0]
    if candidate.get("finishReason"):
        diagnostics["finish_reason"] = candidate["finishReason"]
    if candidate.get("finishReason") not in (None, "STOP"):
        truncated = candidate["finishReason"] == "MAX_TOKENS"
        raise AIError("模型输出达到长度上限" if truncated else "模型输出被安全过滤", retryable=truncated, kind="truncated" if truncated else "filtered")
    return "".join(p.get("text", "") for p in candidate.get("content", {}).get("parts", []) if not p.get("thought"))


async def sse_events(response):
    lines = []
    async for line in response.aiter_lines():
        if not line:
            if lines:
                yield "\n".join(lines)
                lines = []
        elif line.startswith("data:"):
            lines.append(line[5:].lstrip())
    if lines:
        yield "\n".join(lines)


class ThinkingFilter:
    """Hide Qwen think blocks even when tags span SSE chunks."""
    def __init__(self):
        self.buffer, self.thinking, self.removed = "", False, 0

    def feed(self, chunk):
        self.buffer += chunk
        result = ""
        while self.buffer:
            if self.thinking:
                end = self.buffer.lower().find("</think>")
                if end < 0:
                    self.removed += max(0, len(self.buffer) - 7)
                    self.buffer = self.buffer[-7:]
                    break
                self.removed += end + 8
                self.buffer = self.buffer[end + 8:]
                self.thinking = False
            else:
                start = self.buffer.lower().find("<think>")
                if start < 0:
                    # Only retain a possible tag prefix, so normal chunks have no delay.
                    keep = next((n for n in range(min(6, len(self.buffer)), 0, -1) if "<think>".startswith(self.buffer[-n:].lower())), 0)
                    result += self.buffer[:-keep] if keep else self.buffer
                    self.buffer = self.buffer[-keep:] if keep else ""
                    break
                result += self.buffer[:start]
                self.buffer = self.buffer[start + 7:]
                self.removed += 7
                self.thinking = True
        return result

    def finish(self):
        if self.thinking:
            raise AIError("模型仍在思考，未生成最终答案", retryable=True, kind="reasoning_only")
        return self.buffer


def qwen3_classic(provider):
    return provider.protocol == "openai" and re.search(r"(?:^|/)qwen3[-_]", provider.model, re.IGNORECASE) is not None


def unsupported_option(response, names):
    if response.status_code not in (400, 422):
        return False
    text = response.content[:4096].decode("utf-8", errors="replace").lower()
    return any(name.lower() in text for name in names)


async def generate(provider, prompt, *, stream=False, timeout=None, max_tokens=None, usage=None, task=None):
    from app.ai.structured import schema_for, strip_thinking
    usage = usage if usage is not None else {}
    diagnostics = usage.setdefault("diagnostics", {})
    key = provider_key(provider)
    limit = max_tokens or provider.max_output_tokens
    seconds = timeout or provider.timeout_seconds
    schema = schema_for(task)
    structured = getattr(provider, "structured_output", "auto") if schema and not stream else "off"
    thinking = getattr(provider, "thinking_mode", "auto")
    classic = qwen3_classic(provider)
    diagnostics.update(effective_timeout_seconds=round(seconds, 2), effective_max_tokens=limit, thinking_mode=thinking)
    if provider.protocol == "openai":
        url = provider.base_url + "/chat/completions"
        headers = {"Authorization": "Bearer " + key}
        body = {"model": provider.model, "messages": [{"role": "user", "content": prompt}], "stream": stream,
                "max_completion_tokens": limit}
        # New API/vLLM commonly expect max_tokens; configurable through protocol-specific adapter.
        if "api.openai.com" != httpx.URL(provider.base_url).host:
            body["max_tokens"] = body.pop("max_completion_tokens")
            if thinking in ("on", "off") or classic:
                body["chat_template_kwargs"] = {"enable_thinking": thinking == "on"}
                if thinking != "on" and classic:
                    body["messages"][0]["content"] += "\n/no_think"
                diagnostics["thinking_disabled"] = thinking != "on"
        if getattr(provider, "temperature", None) is not None:
            body["temperature"] = provider.temperature
        if structured in ("auto", "schema"):
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": task or "result", "strict": True, "schema": schema}}
            diagnostics["structured_mode"] = "schema"
        elif structured == "object":
            body["response_format"] = {"type": "json_object"}
            diagnostics["structured_mode"] = "object"
    else:
        model = quote(provider.model.removeprefix("models/"), safe="")
        url = f"{provider.base_url}/models/{model}:" + ("streamGenerateContent?alt=sse" if stream else "generateContent")
        headers = {"x-goog-api-key": key}
        body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"maxOutputTokens": limit}}
        if getattr(provider, "temperature", None) is not None:
            body["generationConfig"]["temperature"] = provider.temperature
        if structured != "off":
            body["generationConfig"]["responseMimeType"] = "application/json"
            if structured != "object":
                body["generationConfig"]["responseJsonSchema"] = schema
            diagnostics["structured_mode"] = "object" if structured == "object" else "schema"
        if (thinking == "off" or thinking == "auto" and schema) and "gemini-2.5-flash" in provider.model:
            body["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
            diagnostics["thinking_disabled"] = True
    started = time.monotonic()
    try:
        async with asyncio.timeout(seconds), provider_slot(provider):
            async with httpx.AsyncClient(timeout=seconds, follow_redirects=False) as client:
                if stream:
                    async with client.stream("POST", url, headers=headers, json=body) as response:
                        if response.status_code >= 300:
                            raise status_error(response.status_code, response)
                        if "text/event-stream" not in response.headers.get("content-type", ""):
                            raise AIError("接口未返回 SSE 流", retryable=True, kind="invalid_response")
                        finished = False
                        thinking_filter = ThinkingFilter()
                        async for event in sse_events(response):
                            if event == "[DONE]":
                                finished = True
                                break
                            data = json.loads(event)
                            chunk = parse_payload(data, provider.protocol, usage, True)
                            if provider.protocol == "gemini":
                                finished = finished or any(c.get("finishReason") == "STOP" for c in data.get("candidates", []))
                            else:
                                finished = finished or any(c.get("finish_reason") == "stop" for c in data.get("choices", []))
                            chunk = thinking_filter.feed(chunk)
                            if chunk:
                                diagnostics.setdefault("first_token_ms", round((time.monotonic() - started) * 1000))
                                diagnostics["response_chars"] = diagnostics.get("response_chars", 0) + len(chunk)
                                yield chunk
                        if not finished:
                            raise AIError("流式连接在生成完成前中断", retryable=True, kind="connection")
                        final = thinking_filter.finish()
                        diagnostics["reasoning_chars"] = diagnostics.get("reasoning_chars", 0) + thinking_filter.removed
                        if final:
                            yield final
                else:
                    # Capability negotiation stays inside the same timeout/concurrency slot.
                    for _ in range(4):
                        response = await client.post(url, headers=headers, json=body)
                        if response.status_code < 300:
                            break
                        if structured == "auto" and unsupported_option(response, ("response_format", "json_schema", "json_object", "responsejsonschema", "response_json_schema")):
                            if provider.protocol == "openai" and "response_format" in body:
                                if body["response_format"]["type"] == "json_schema":
                                    body["response_format"] = {"type": "json_object"}
                                    diagnostics["structured_mode"] = "object"
                                else:
                                    body.pop("response_format")
                                    diagnostics["structured_mode"] = "prompt_only"
                            elif provider.protocol == "gemini" and "responseJsonSchema" in body["generationConfig"]:
                                body["generationConfig"].pop("responseJsonSchema")
                                diagnostics["structured_mode"] = "object"
                            else:
                                raise status_error(response.status_code, response)
                            diagnostics["capability_downgrades"] = diagnostics.get("capability_downgrades", 0) + 1
                            continue
                        if thinking == "auto" and "chat_template_kwargs" in body and unsupported_option(response, ("chat_template_kwargs", "enable_thinking")):
                            body.pop("chat_template_kwargs")
                            diagnostics["thinking_control"] = "prompt_only"
                            continue
                        raise status_error(response.status_code, response)
                    if response.status_code >= 300:
                        raise status_error(response.status_code, response)
                    raw = parse_payload(response.json(), provider.protocol, usage, False)
                    content = strip_thinking(raw)
                    diagnostics["response_chars"] = len(content)
                    hidden_chars = len(raw) - len(content) if raw.lstrip().lower().startswith("<think") or "</think>" in raw and not raw.lstrip().startswith(("{", "[", "```")) else 0
                    diagnostics["reasoning_chars"] = diagnostics.get("reasoning_chars", 0) + hidden_chars
                    if not content and diagnostics.get("reasoning_chars"):
                        raise AIError("模型只返回思考内容，未生成最终答案", retryable=True, kind="reasoning_only")
                    yield content
    except (TimeoutError, httpx.TimeoutException):
        raise AIError("AI 请求超时", retryable=True, kind="timeout", details={"phase": "generation", "timeout_seconds": round(seconds, 2)}) from None
    except httpx.RequestError:
        raise AIError("无法连接 AI 服务，请检查地址和网络", retryable=True, kind="connection") from None
    except (ValueError, KeyError, TypeError, AttributeError):
        raise AIError("AI 服务响应格式无效", retryable=True, kind="invalid_response") from None
