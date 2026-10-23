"""Durable raw response chunks; independent transactions make output visible during a step."""

import logging

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal
from app.models.workbench import WBDebugEvent, now
from app.services.workbench_limits import MAX_DEBUG_EVENTS, RETENTION


async def emit(user_id, output):
    if not output:
        return
    try:
        async with AsyncSessionLocal() as db:
            for offset in range(0, len(output), 16000):
                db.add(
                    WBDebugEvent(
                        user_id=user_id,
                        output=output[offset : offset + 16000],
                        expires_at=now() + RETENTION,
                    )
                )
            await db.flush()
            cutoff = (
                select(WBDebugEvent.id)
                .where(WBDebugEvent.user_id == user_id)
                .order_by(WBDebugEvent.id.desc())
                .offset(MAX_DEBUG_EVENTS - 1)
                .limit(1)
                .scalar_subquery()
            )
            await db.execute(
                delete(WBDebugEvent).where(
                    WBDebugEvent.user_id == user_id, WBDebugEvent.id < cutoff
                )
            )
            await db.commit()
    except Exception:
        logging.getLogger(__name__).warning("工作台调试输出暂不可用，业务步骤继续执行")
