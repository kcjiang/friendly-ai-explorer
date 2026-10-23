"""Durable FIFO for manual and scheduled checks, with cross-worker exclusion."""

import logging
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import exists, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, engine
from app.models.user import User
from app.models.workbench import WBCheck, WBPreference, now
from app.services.workbench_collection import run_collection
from app.services.workbench_limits import COLLECTION_PAUSE_SECONDS
from app.services.workbench_schedule import next_slot, working

ACTIVE = ("queued", "running")
logger = logging.getLogger(__name__)


def public_check(check):
    if check is None:
        return None
    return {
        key: getattr(check, key)
        for key in ("id", "status", "queued_at", "started_at", "finished_at", "error")
    }


async def enqueue_manual(db, user_id):
    # Serialize enqueue operations for this user across tabs and API replicas.
    await db.scalar(
        select(WBPreference).where(WBPreference.user_id == user_id).with_for_update()
    )
    check = await db.scalar(
        select(WBCheck).where(
            WBCheck.user_id == user_id,
            WBCheck.origin == "manual",
            WBCheck.status.in_(ACTIVE),
        )
    )
    accepted = check is None
    if accepted:
        check = WBCheck(user_id=user_id, origin="manual")
        db.add(check)
        await db.flush()
    return {"accepted": accepted, "check": public_check(check)}


async def enqueue_due_checks():
    async with AsyncSessionLocal() as db:
        current = now()
        preferences = list(
            (
                await db.scalars(
                    select(WBPreference)
                    .where(WBPreference.next_run_at <= current)
                    .order_by(WBPreference.next_run_at, WBPreference.user_id)
                    .limit(100)
                    .with_for_update(skip_locked=True)
                )
            ).all()
        )
        for pref in preferences:
            user = await db.get(User, pref.user_id)
            pref.next_run_at = (
                next_slot(pref.schedule, current) if user and user.is_active else None
            )
            if (
                not user
                or not user.is_active
                or not pref.schedule["enabled"]
                or not working(pref.schedule, current)
            ):
                continue
            # A scheduled tick does not duplicate work already pending for the user.
            pending = await db.scalar(
                select(
                    exists().where(
                        WBCheck.user_id == pref.user_id, WBCheck.status.in_(ACTIVE)
                    )
                )
            )
            if not pending:
                db.add(WBCheck(user_id=pref.user_id, origin="scheduled"))
        await db.commit()


async def process_check():
    async with engine.connect() as conn:
        if not await conn.scalar(text("SELECT pg_try_advisory_lock(74182101)")):
            return False
        await conn.commit()
        try:
            async with AsyncSession(bind=conn, expire_on_commit=False) as db:
                # Acquiring the global lock proves no previous check is still executing.
                # A running row therefore belongs to a disconnected worker and can resume.
                check = await db.scalar(
                    select(WBCheck)
                    .where(WBCheck.status.in_(ACTIVE))
                    .order_by(WBCheck.id)
                    .limit(1)
                    .with_for_update()
                )
                if check is None:
                    return False
                last_finished = await db.scalar(select(func.max(WBCheck.finished_at)))
                if last_finished and now() < last_finished + timedelta(
                    seconds=COLLECTION_PAUSE_SECONDS
                ):
                    return False
                user = await db.get(User, check.user_id)
                pref = await db.get(WBPreference, check.user_id)
                schedule = (
                    pref.schedule if pref and check.origin == "scheduled" else None
                )
                if (
                    not user
                    or not user.is_active
                    or not pref
                    or (
                        schedule
                        and (not schedule["enabled"] or not working(schedule, now()))
                    )
                ):
                    check.status, check.finished_at = "completed", now()
                    await db.commit()
                    return True
                check.status, check.started_at, check.error = "running", now(), None
                pref.last_run_at = check.started_at
                await db.commit()
                check_id = check.id
                try:
                    executed = await run_collection(check.user_id, schedule)
                    if not executed:
                        check.status, check.started_at = "queued", None
                    else:
                        check.status, check.finished_at = "completed", now()
                except Exception as exc:
                    # A failed check must release deduplication and let the next user run.
                    await db.rollback()
                    check = await db.get(WBCheck, check_id)
                    check.status, check.finished_at = "failed", now()
                    check.error = (
                        str(exc.detail)[:1000]
                        if isinstance(exc, HTTPException)
                        else "检查更新失败，请检查邮箱与平台配置后重试"
                    )
                    logger.warning("工作台收取检查失败", exc_info=False)
                await db.commit()
                return check.status != "queued"
        finally:
            await conn.rollback()
            await conn.execute(text("SELECT pg_advisory_unlock(74182101)"))
            await conn.commit()
