from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.i18n import message as system_message
from app.middleware.rbac import DevOnly
from app.services.app_log_service import read_logs

router = APIRouter()


@router.get("/logs", summary="查询后端应用日志")
async def app_logs(
    user: DevOnly,
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] | None = None,
    q: str = Query("", max_length=100),
    request_id: str = Query("", max_length=64),
    since: datetime | None = None,
    until: datetime | None = None,
    page: int = Query(1, ge=1, le=200),
    page_size: int = Query(50, ge=1, le=100),
):
    since = (
        since.replace(tzinfo=timezone.utc) if since and since.tzinfo is None else since
    )
    until = (
        until.replace(tzinfo=timezone.utc) if until and until.tzinfo is None else until
    )
    if since and until and since > until:
        raise HTTPException(
            422, system_message("errors.startTimeMustNotBeAfterEndTime")
        )
    return await run_in_threadpool(
        read_logs,
        level=level,
        q=q,
        request_id=request_id,
        since=since,
        until=until,
        page=page,
        page_size=page_size,
    )
