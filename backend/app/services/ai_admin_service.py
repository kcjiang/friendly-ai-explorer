import time
from dataclasses import replace
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select

from app.ai.capabilities import missing_capabilities, requirements
from app.ai.provider_client import AIError, encrypt_key, provider_key
from app.ai.router import Provider, stream
from app.i18n import message as system_message
from app.models.ai_config import AICallLog, AIProvider, AIRoute
from app.schemas.ai_config import TASKS


def public_provider(row):
    fields = (
        "id",
        "name",
        "vendor",
        "auth_required",
        "token_parameter",
        "capability_checks",
        "protocol",
        "base_url",
        "model",
        "enabled",
        "timeout_seconds",
        "max_output_tokens",
        "max_concurrency",
        "thinking_mode",
        "structured_output",
        "temperature",
        "retry_count",
        "last_test_at",
        "last_test_ok",
        "last_test_message",
        "updated_at",
    )
    return {
        **{k: getattr(row, k) for k in fields},
        "has_api_key": bool(row.api_key_encrypted),
    }


async def get_provider(db, provider_id):
    row = await db.get(AIProvider, provider_id)
    if not row:
        raise HTTPException(404, system_message("errors.aiServiceNotFound"))
    return row


async def list_providers(db):
    return [
        public_provider(p)
        for p in (await db.scalars(select(AIProvider).order_by(AIProvider.name))).all()
    ]


async def locked_routes(db):
    return (
        await db.scalars(select(AIRoute).order_by(AIRoute.task).with_for_update())
    ).all()


async def save_provider(db, body, provider_id=None):
    routes = await locked_routes(db)
    row = await get_provider(db, provider_id) if provider_id else AIProvider()
    if not body.enabled and any(
        row.id in (r.provider_id, r.fallback_provider_id) for r in routes if row.id
    ):
        raise HTTPException(
            409,
            system_message(
                "errors.thisServiceIsAssignedToTasksReassignThemBeforeDisablingIt"
            ),
        )
    key = body.api_key.get_secret_value().strip() if body.api_key else ""
    if body.auth_required and not key and not row.api_key_encrypted:
        raise HTTPException(
            422, system_message("errors.enterAKeyWhenEnablingApiKeyAuthentication")
        )
    if body.auth_required and provider_id and row.protocol != body.protocol and not key:
        raise HTTPException(
            422, system_message("errors.enterTheApiKeyAgainWhenChangingApiType")
        )
    # Renaming and concurrency changes do not invalidate a verified model.
    identity_fields = (
        "protocol",
        "base_url",
        "model",
        "auth_required",
        "token_parameter",
        "thinking_mode",
        "structured_output",
        "temperature",
        "max_output_tokens",
        "timeout_seconds",
    )
    invalidate = (
        not provider_id
        or bool(key)
        or any(getattr(row, f) != getattr(body, f) for f in identity_fields)
    )
    if invalidate:
        row.capability_checks = {}
    if not body.auth_required:
        row.api_key_encrypted = None
    for field, value in body.model_dump(exclude={"api_key"}).items():
        setattr(row, field, value)
    if key and body.auth_required:
        row.api_key_encrypted = encrypt_key(key)
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
        raise HTTPException(
            409,
            system_message(
                "errors.thisServiceIsAssignedToTasksReassignThemBeforeDeletingIt"
            ),
        )
    await db.delete(row)
    await db.commit()
    return {"message": system_message("errors.aiDeleted")}


async def list_routes(db):
    rows = (await db.scalars(select(AIRoute))).all()
    by_task = {r.task: r for r in rows}
    if set(by_task) != set(TASKS):
        raise HTTPException(
            503,
            system_message(
                "errors.aiRoutesAreNotInitializedInitializeTheDatabaseWithTheCurrentVersion"
            ),
        )
    return [
        {
            "task": task,
            "label": label,
            "provider_id": by_task[task].provider_id,
            "fallback_provider_id": by_task[task].fallback_provider_id,
            "timeout_seconds": by_task[task].timeout_seconds,
            "max_output_tokens": by_task[task].max_output_tokens,
            "requirements": requirements(task),
        }
        for task, label in TASKS.items()
    ]


async def save_routes(db, body):
    rows = {r.task: r for r in await locked_routes(db)}
    if set(rows) != set(TASKS):
        raise HTTPException(
            503,
            system_message(
                "errors.aiRoutesAreNotInitializedInitializeTheDatabaseWithTheCurrentVersion"
            ),
        )
    default = next(r for r in body.routes if r.task == "default")
    for route in body.routes:
        primary = route.provider_id or default.provider_id
        fallback = route.fallback_provider_id or (
            default.fallback_provider_id if not route.provider_id else None
        )
        if not primary and fallback:
            raise HTTPException(
                422,
                system_message(
                    "errors.selectAPrimaryServiceBeforeConfiguringAFallback"
                ),
            )
        if primary and primary == fallback:
            raise HTTPException(
                422,
                system_message(
                    "errors.effectivePrimaryAndFallbackServicesMustBeDifferent"
                ),
            )
        for provider_id in (primary, fallback):
            if provider_id:
                provider = await get_provider(db, provider_id)
                if not provider.enabled:
                    raise HTTPException(
                        422, system_message("errors.onlyEnabledAiServicesCanBeAssigned")
                    )
                missing = missing_capabilities(provider, route.task)
                if missing:
                    raise HTTPException(422, system_message("errors.capabilityMissing"))
                try:
                    provider_key(provider)
                except AIError as exc:
                    raise HTTPException(422, str(exc)) from None
    # Validate the complete assignment before mutating any route.
    for route in body.routes:
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
        prompt = (
            '只返回 JSON 对象 {"ok": true}，不要解释。'
            if mode == "json"
            else "请简短回复：连接测试成功。"
        )
        # Test the exact same retry/validation path as business calls, without fallback.
        history = None
        if mode == "conversation":
            history = [
                {"role": "user", "content": "记住校验码 FAE742。"},
                {"role": "assistant", "content": "已记住。"},
            ]
            prompt = "只返回我之前告诉你的校验码，不要其他内容。"
        async for chunk in stream(
            "test_" + mode,
            prompt,
            streaming=mode == "stream",
            plan=(
                [replace(snapshot, enabled=True)],
                snapshot.timeout_seconds,
                min(snapshot.max_output_tokens, 256),
            ),
            report=usage,
            history=history,
        ):
            result += chunk
        if not result.strip():
            raise AIError(system_message("errors.theModelReturnedAnEmptyAnswer"))
        ok, message = True, system_message("errors.testPassed")
    except AIError as exc:
        message = str(exc)
        usage.setdefault("diagnostics", {}).update(error_kind=exc.kind, **exc.details)
    elapsed = round((time.monotonic() - started) * 1000)
    tested_at = datetime.now(timezone.utc)
    # Compare and update atomically: an edit may finish while a test is in flight.
    # Lock and merge so concurrent capability tests cannot overwrite each other.
    current_row = await db.scalar(
        select(AIProvider)
        .where(AIProvider.id == provider_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    current = current_row is not None and current_row.updated_at == version
    checks = {}
    if current:
        checks = dict(current_row.capability_checks or {})
        capability = {
            "chat": "text",
            "json": "json",
            "stream": "stream",
            "conversation": "conversation",
        }[mode]
        kind = usage.get("diagnostics", {}).get("error_kind")
        status = (
            "verified"
            if ok
            else "unsupported"
            if kind
            in ("invalid_output", "invalid_json", "invalid_parameter", "http_error")
            else "unknown"
        )
        checks[capability] = {"status": status, "tested_at": tested_at.isoformat()}
        if ok:
            checks["text"] = {"status": "verified", "tested_at": tested_at.isoformat()}
        current_row.capability_checks = checks
        (
            current_row.last_test_at,
            current_row.last_test_ok,
            current_row.last_test_message,
        ) = tested_at, ok, message
    await db.commit()
    return {
        "ok": ok,
        "message": message,
        "elapsed_ms": elapsed,
        "model": snapshot.model,
        "reply": result[:2000] if ok else "",
        "tested_at": tested_at,
        "mode": mode,
        "configuration_current": current,
        "diagnostics": usage.get("diagnostics", {}),
        "capability_checks": checks,
    }


async def list_logs(db):
    rows = (
        await db.scalars(
            select(AICallLog).order_by(AICallLog.created_at.desc()).limit(100)
        )
    ).all()
    fields = (
        "id",
        "task",
        "provider_name",
        "model",
        "success",
        "fallback",
        "elapsed_ms",
        "input_tokens",
        "output_tokens",
        "error",
        "created_at",
        "request_id",
        "diagnostics",
    )
    return [{k: getattr(row, k) for k in fields} for row in rows]
