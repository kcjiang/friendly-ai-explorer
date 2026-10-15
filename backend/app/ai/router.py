"""Resolve a fresh immutable routing snapshot for each request."""
import asyncio
import hashlib
import json
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select

from app.ai.provider_client import AIError, generate
from app.ai.structured import parse_json, schema_for
from app.database import AsyncSessionLocal
from app.logging_config import log_event, request_id_context, safe_data
from app.models.ai_config import AICallLog, AIProvider, AIRoute

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Provider:
    id: UUID
    name: str
    protocol: str
    base_url: str
    model: str
    api_key_encrypted: str | None
    use_env_key: bool
    enabled: bool
    timeout_seconds: int
    max_output_tokens: int
    max_concurrency: int
    thinking_mode: str = "auto"
    structured_output: str = "auto"
    temperature: float | None = None
    retry_count: int = 1

    @classmethod
    def snapshot(cls, row):
        return cls(**{field: getattr(row, field) for field in cls.__dataclass_fields__})


async def resolve(task):
    async with AsyncSessionLocal() as db:
        routes = {r.task: r for r in (await db.scalars(select(AIRoute))).all()}
        default = routes.get("default")
        route = routes.get(task)
        if not default or not route:
            raise AIError("AI 路由未初始化，请执行 v8 数据库迁移")
        primary = route.provider_id or default.provider_id
        # Explicit task routes own their fallback. Following default also follows its fallback.
        fallback = route.fallback_provider_id or (default.fallback_provider_id if not route.provider_id else None)
        ids = list(dict.fromkeys(i for i in (primary, fallback) if i))
        rows = {p.id: p for p in (await db.scalars(select(AIProvider).where(AIProvider.id.in_(ids)))).all()}
        if primary not in rows:
            raise AIError("未配置默认 AI 服务")
        providers = [Provider.snapshot(rows[i]) for i in ids if i in rows]
        return providers, route.timeout_seconds or default.timeout_seconds, route.max_output_tokens or default.max_output_tokens


def validate_result(task, raw):
    if not raw.strip():
        raise AIError("模型返回空回答", retryable=True, kind="invalid_output")
    if task == "todo":
        data = parse_json(raw)
        if isinstance(data, dict):
            data = data.get("todos", data.get("items"))
        if isinstance(data, list):
            priority_map = {"critical": "critical", "high": "critical", "major": "major", "medium": "major", "trivial": "trivial", "low": "trivial", "高": "critical", "中": "major", "低": "trivial"}
            data = [{"task": item.get("task", item.get("title")), "priority": priority_map.get(str(item.get("priority", "")).lower(), item.get("priority"))} if isinstance(item, dict) else item for item in data]
        if not isinstance(data, list) or not 1 <= len(data) <= 8 or any(
            not isinstance(item, dict) or not isinstance(item.get("task"), str) or not item["task"].strip()
            or item.get("priority") not in ("critical", "major", "trivial") for item in data
        ):
            raise AIError("TODO 输出结构无效", retryable=True, kind="invalid_output")
        return json.dumps(data, ensure_ascii=False)
    if task == "test_json":
        data = parse_json(raw)
        if not isinstance(data, dict) or set(data) != {"ok"} or data["ok"] is not True:
            raise AIError("JSON 测试未返回预期结构", retryable=True, kind="invalid_output")
        return json.dumps(data)
    if task == "email_analysis":
        data = parse_json(raw)
        if not isinstance(data, dict) or any(type(data.get(k)) is not bool for k in ("is_customer_email", "is_defect_report")) or not isinstance(data.get("summary"), str):
            raise AIError("邮件分析输出结构无效", retryable=True, kind="invalid_output")
        ticket = data.get("ticket")
        if data["is_defect_report"] and (
            not isinstance(ticket, dict) or not isinstance(ticket.get("title"), str) or not ticket["title"].strip()
            or ticket.get("priority") not in ("critical", "high", "medium", "low")
            or any(ticket.get(k) is not None and not isinstance(ticket[k], str) for k in ("description", "customer_name", "customer_contact", "product_name", "firmware_version"))
        ):
            raise AIError("邮件工单输出结构无效", retryable=True, kind="invalid_output")
        return json.dumps(data, ensure_ascii=False)
    return raw


async def record_call(provider, task, success, fallback, started, usage, error=None):
    elapsed = round((time.monotonic() - started) * 1000)
    diagnostics = safe_data(usage.get("diagnostics", {}))
    request_id = request_id_context.get() or None
    log_event(logging.INFO if success else logging.WARNING, "AI 调用成功" if success else "AI 调用失败",
              task=task, provider=provider.name, model=provider.model, fallback=fallback, elapsed_ms=elapsed,
              error=error, input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"), **diagnostics)
    try:
        async with AsyncSessionLocal() as db:
            db.add(AICallLog(task=task, provider_id=provider.id, provider_name=provider.name, model=provider.model,
                             success=success, fallback=fallback, elapsed_ms=elapsed,
                             input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"), error=error,
                             request_id=request_id, diagnostics=diagnostics))
            await db.commit()
    except Exception:
        # Logging must not undo an otherwise successful business request. No SQL parameters/secrets in logs.
        logger.warning("AI 调用记录写入失败，应用日志中仍保留本次记录", exc_info=True)


async def stream(task, prompt, *, streaming=True, plan=None, report=None):
    providers, timeout, max_tokens = plan or await resolve(task)
    for index, provider in enumerate(providers):
        deadline = time.monotonic() + (timeout or provider.timeout_seconds)
        # Only implicit limits are capped. Explicit task/default overrides remain authoritative.
        limit = max_tokens or min(provider.max_output_tokens, {"todo": 768, "email_analysis": 1024, "ticket_analysis": 1536}.get(task, 2048))
        retry, repaired, attempt, current_prompt = 0, False, 0, prompt
        while True:
            started, usage, emitted = time.monotonic(), {"diagnostics": {"attempt": attempt + 1, "repair": repaired}}, False
            attempt += 1
            try:
                if not provider.enabled:
                    raise AIError("分配的 AI 服务已禁用", retryable=True, kind="disabled")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise AIError("AI 请求总预算已用尽", retryable=True, kind="timeout")
                if streaming:
                    async for chunk in generate(provider, current_prompt, stream=True, timeout=remaining, max_tokens=limit, usage=usage, task=task):
                        if chunk:
                            emitted = True
                            yield chunk
                    if not emitted:
                        raise AIError("模型返回空回答", retryable=True, kind="invalid_output")
                else:
                    raw = "".join([chunk async for chunk in generate(provider, current_prompt, timeout=remaining, max_tokens=limit, usage=usage, task=task)])
                    result = validate_result(task, raw)
                    emitted = True
                    yield result
            except AIError as exc:
                usage["diagnostics"].update(error_kind=exc.kind, **exc.details)
                if report is not None:
                    report.clear()
                    report.update(usage)
                await record_call(provider, task, False, bool(index), started, usage, str(exc))
                if emitted:
                    raise  # Never concatenate different attempts once output is visible.
                remaining = deadline - time.monotonic()
                if exc.kind in ("invalid_json", "invalid_output", "reasoning_only") and schema_for(task) and not repaired and remaining > 2:
                    repaired = True
                    shape = '{"todos":[{"task":"简短任务","priority":"major"}]}' if task == "todo" else '{"ok":true}' if task == "test_json" else "原要求的邮件分析字段"
                    current_prompt = prompt + '\n上次未得到所需 JSON。请直接给出最终 JSON 对象，不要思考、解释或 Markdown。输出结构：' + shape
                    log_event(logging.WARNING, "结构化输出校验失败，准备重试一次", task=task, provider=provider.name, error_kind=exc.kind, remaining_seconds=round(remaining, 2))
                    continue
                delay = max(min(2 ** retry * 0.5, 2), exc.details.get("retry_after_seconds", 0))
                if exc.kind in ("upstream_unavailable", "rate_limit", "connection") and retry < provider.retry_count and remaining > delay + 1:
                    retry += 1
                    log_event(logging.WARNING, "AI 上游临时故障，等待重试", task=task, provider=provider.name, retry=retry, delay_seconds=delay, error_kind=exc.kind)
                    await asyncio.sleep(delay)
                    continue
                if not exc.retryable or index == len(providers) - 1:
                    raise
                log_event(logging.WARNING, "AI 主服务失败，切换备用服务", task=task, provider=provider.name, error_kind=exc.kind)
                break
            except (asyncio.CancelledError, GeneratorExit):
                await record_call(provider, task, False, bool(index), started, usage, "调用已取消")
                raise
            if report is not None:
                report.clear()
                report.update(usage)
            await record_call(provider, task, True, bool(index), started, usage)
            return


_todo_cache = OrderedDict()
_todo_inflight = {}


async def chat(task, prompt):
    plan = await resolve(task)
    cache_key = None
    if task == "todo":
        # Hash all routing options and the prompt; changes in tickets, date, credentials or
        # routing bypass the cache immediately. No plaintext prompts retained.
        cache_key = hashlib.sha256((repr(plan) + prompt).encode()).hexdigest()
        cached = _todo_cache.get(cache_key)
        if cached and cached[0] > time.monotonic():
            _todo_cache.move_to_end(cache_key)
            return cached[1]
    async def run():
        result = "".join([chunk async for chunk in stream(task, prompt, streaming=False, plan=plan)])
        if cache_key:
            _todo_cache[cache_key] = (time.monotonic() + 120, result)
            _todo_cache.move_to_end(cache_key)
            while len(_todo_cache) > 256:
                _todo_cache.popitem(last=False)
        return result
    if not cache_key:
        return await run()
    if cache_key not in _todo_inflight:
        work = asyncio.create_task(run())
        _todo_inflight[cache_key] = work
        def completed(work):
            _todo_inflight.pop(cache_key, None)
            if not work.cancelled():
                work.exception()  # retrieve errors even if all callers disconnect
        work.add_done_callback(completed)
    return await asyncio.shield(_todo_inflight[cache_key])
