import time
from dataclasses import replace
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, update

from app.ai.provider_client import AIError, encrypt_key, provider_key
from app.ai.router import Provider, stream
from app.models.ai_config import AICallLog, AIProvider, AIRoute
from app.schemas.ai_config import TASKS


def public_provider(row):
    fields = ("id", "name", "protocol", "base_url", "model", "enabled", "timeout_seconds", "max_output_tokens", "max_concurrency", "thinking_mode", "structured_output", "temperature", "retry_count", "last_test_at", "last_test_ok", "last_test_message", "updated_at")
    return {**{k: getattr(row, k) for k in fields}, "has_api_key": bool(row.api_key_encrypted or (row.use_env_key and _has_env_key())),
            "key_source": "environment" if row.use_env_key and not row.api_key_encrypted else "stored"}


def _has_env_key():
    from app.config import settings
    return bool(settings.google_api_key)


async def get_provider(db, provider_id):
    row = await db.get(AIProvider, provider_id)
    if not row:
        raise HTTPException(404, "AI 服务不存在")
    return row


async def list_providers(db):
    return [public_provider(p) for p in (await db.scalars(select(AIProvider).order_by(AIProvider.name))).all()]


async def locked_routes(db):
    return (await db.scalars(select(AIRoute).order_by(AIRoute.task).with_for_update())).all()


async def save_provider(db, body, provider_id=None):
    routes = await locked_routes(db)
    row = await get_provider(db, provider_id) if provider_id else AIProvider(use_env_key=False)
    if not body.enabled and any(row.id in (r.provider_id, r.fallback_provider_id) for r in routes if row.id):
        raise HTTPException(409, "该服务仍被任务使用，请先调整任务分配，再禁用")
    key = body.api_key.get_secret_value().strip() if body.api_key else ""
    if not provider_id and not key:
        raise HTTPException(422, "新建服务必须填写 API Key")
    if provider_id and row.protocol != body.protocol and not key:
        raise HTTPException(422, "更改接口类型时请重新填写 API Key")
    for field, value in body.model_dump(exclude={"api_key"}).items():
        setattr(row, field, value)
    if key:
        row.api_key_encrypted = encrypt_key(key)
        row.use_env_key = False
    row.updated_at = datetime.now(timezone.utc)
    row.last_test_at = row.last_test_ok = row.last_test_message = None
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return public_provider(row)


async def delete_provider(db, provider_id):
    routes = await locked_routes(db)
    row = await get_provider(db, provider_id)
    if any(provider_id in (r.provider_id, r.fallback_provider_id) for r in routes):
        raise HTTPException(409, "该服务仍被任务使用，请先调整任务分配，再删除")
    await db.delete(row)
    await db.commit()
    return {"message": "已删除 AI 服务"}


async def list_routes(db):
    rows = (await db.scalars(select(AIRoute))).all()
    by_task = {r.task: r for r in rows}
    if set(by_task) != set(TASKS):
        raise HTTPException(503, "AI 路由未初始化，请执行 v8 数据库迁移")
    return [{"task": task, "label": label, "provider_id": by_task[task].provider_id,
             "fallback_provider_id": by_task[task].fallback_provider_id,
             "timeout_seconds": by_task[task].timeout_seconds,
             "max_output_tokens": by_task[task].max_output_tokens} for task, label in TASKS.items()]


async def save_routes(db, body):
    rows = {r.task: r for r in await locked_routes(db)}
    if set(rows) != set(TASKS):
        raise HTTPException(503, "AI 路由未初始化，请执行 v8 数据库迁移")
    default = next(r for r in body.routes if r.task == "default")
    for route in body.routes:
        primary = route.provider_id or default.provider_id
        fallback = route.fallback_provider_id or (default.fallback_provider_id if not route.provider_id else None)
        if primary == fallback:
            raise HTTPException(422, "任务的实际主服务与备用服务不能相同")
        for provider_id in (primary, fallback):
            if provider_id:
                provider = await get_provider(db, provider_id)
                if not provider.enabled:
                    raise HTTPException(422, "只能分配已启用的 AI 服务")
                try:
                    provider_key(provider)
                except AIError as exc:
                    raise HTTPException(422, str(exc)) from None
        for field, value in route.model_dump(exclude={"task"}).items():
            setattr(rows[route.task], field, value)
    await db.commit()
    return await list_routes(db)


async def test_provider(db, provider_id, mode):
    row = await get_provider(db, provider_id)
    snapshot = Provider.snapshot(row)
    version = row.updated_at
    # Don't hold a transaction/connection while waiting for an external API.
    await db.rollback()
    started, usage, result, ok = time.monotonic(), {}, "", False
    try:
        prompt = '只返回 JSON 对象 {"ok": true}，不要解释。' if mode == "json" else "请简短回复：连接测试成功。"
        # Test the exact same retry/validation path as business calls, without fallback.
        async for chunk in stream("test_" + mode, prompt, streaming=mode == "stream",
                                  plan=([replace(snapshot, enabled=True)], snapshot.timeout_seconds, min(snapshot.max_output_tokens, 256)), report=usage):
            result += chunk
        if not result.strip():
            raise AIError("模型返回空回答")
        ok, message = True, "测试成功"
    except AIError as exc:
        message = str(exc)
        usage.setdefault("diagnostics", {}).update(error_kind=exc.kind, **exc.details)
    elapsed = round((time.monotonic() - started) * 1000)
    tested_at = datetime.now(timezone.utc)
    # Compare and update atomically: an edit may finish while a test is in flight.
    saved = await db.execute(update(AIProvider).where(AIProvider.id == provider_id, AIProvider.updated_at == version)
                             .values(last_test_at=tested_at, last_test_ok=ok, last_test_message=message)
                             .execution_options(synchronize_session=False))
    current = bool(saved.rowcount)
    await db.commit()
    return {"ok": ok, "message": message, "elapsed_ms": elapsed, "model": snapshot.model,
            "reply": result[:2000] if ok else "", "tested_at": tested_at, "mode": mode, "configuration_current": current,
            "diagnostics": usage.get("diagnostics", {})}


async def list_logs(db):
    rows = (await db.scalars(select(AICallLog).order_by(AICallLog.created_at.desc()).limit(100))).all()
    fields = ("id", "task", "provider_name", "model", "success", "fallback", "elapsed_ms", "input_tokens", "output_tokens", "error", "created_at", "request_id", "diagnostics")
    return [{k: getattr(row, k) for k in fields} for row in rows]
