"""Exercise durable queue concurrency, FIFO, recovery and scheduled coalescing."""

import asyncio
import unittest
from datetime import timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, engine
from app.models.user import User, UserRole
from app.models.workbench import WBCheck, WBPreference, now
from app.schemas.workbench import Schedule
from app.services import workbench_checks as checks


class CheckQueueTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.ids = [uuid4(), uuid4()]
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        id=ident,
                        name="Queue test",
                        email=f"{ident}@example.invalid",
                        role=UserRole.engineer,
                        password_hash="not-a-login",
                        is_active=True,
                    )
                    for ident in self.ids
                ]
            )
            await db.flush()
            db.add_all(
                [
                    WBPreference(
                        user_id=ident, schedule=Schedule(enabled=False).model_dump()
                    )
                    for ident in self.ids
                ]
            )
            await db.commit()

    async def asyncTearDown(self):
        async with AsyncSessionLocal() as db:
            await db.execute(delete(User).where(User.id.in_(self.ids)))
            await db.commit()
        await engine.dispose()

    async def enqueue(self, user_id):
        async with AsyncSessionLocal() as db:
            result = await checks.enqueue_manual(db, user_id)
            await db.commit()
            return result

    async def test_concurrent_clicks_create_one_check_and_can_follow_a_scheduled_check(
        self,
    ):
        async with AsyncSessionLocal() as db:
            scheduled = WBCheck(
                user_id=self.ids[0], origin="scheduled", status="running"
            )
            db.add(scheduled)
            await db.commit()
            scheduled_id = scheduled.id
        results = await asyncio.gather(*(self.enqueue(self.ids[0]) for _ in range(5)))
        self.assertEqual(sum(result["accepted"] for result in results), 1)
        self.assertEqual(len({result["check"]["id"] for result in results}), 1)
        self.assertGreater(results[0]["check"]["id"], scheduled_id)

    async def test_fifo_recovers_a_disconnected_worker_and_failure_obeys_cooldown(self):
        first = (await self.enqueue(self.ids[0]))["check"]["id"]
        second = (await self.enqueue(self.ids[1]))["check"]["id"]
        async with AsyncSessionLocal() as db:
            row = await db.get(WBCheck, first)
            row.status, row.started_at = "running", now() - timedelta(minutes=10)
            await db.commit()
        with patch.object(
            checks,
            "run_collection",
            AsyncMock(side_effect=[HTTPException(502, "Test failure"), True]),
        ) as run:
            self.assertTrue(await checks.process_check())
            self.assertFalse(await checks.process_check())
            self.assertEqual(run.await_count, 1)
            async with AsyncSessionLocal() as db:
                row = await db.get(WBCheck, first)
                self.assertEqual(row.status, "failed")
                self.assertEqual(row.error, "Test failure")
                self.assertEqual((await db.get(WBCheck, second)).status, "queued")
                row.finished_at -= timedelta(seconds=6)
                await db.commit()
            self.assertTrue(await checks.process_check())
            self.assertEqual(
                [call.args for call in run.await_args_list],
                [(self.ids[0], None), (self.ids[1], None)],
            )
        self.assertTrue((await self.enqueue(self.ids[0]))["accepted"])

    async def test_user_lock_contention_requeues_without_losing_deduplication(self):
        ident = (await self.enqueue(self.ids[0]))["check"]["id"]
        with patch.object(checks, "run_collection", AsyncMock(return_value=False)):
            self.assertFalse(await checks.process_check())
        result = await self.enqueue(self.ids[0])
        self.assertFalse(result["accepted"])
        self.assertEqual(result["check"]["id"], ident)
        self.assertEqual(result["check"]["status"], "queued")
        self.assertIsNone(result["check"]["finished_at"])

    async def test_scheduled_ticks_do_not_duplicate_a_pending_manual_check(self):
        await self.enqueue(self.ids[0])
        async with AsyncSessionLocal() as db:
            for ident in self.ids:
                pref = await db.get(WBPreference, ident)
                pref.schedule = Schedule(enabled=True).model_dump()
                pref.next_run_at = now() - timedelta(seconds=1)
            await db.commit()
        with patch.object(checks, "working", return_value=True):
            await checks.enqueue_due_checks()
            await checks.enqueue_due_checks()
        async with AsyncSessionLocal() as db:
            rows = list(
                (
                    await db.scalars(
                        select(WBCheck)
                        .where(WBCheck.user_id.in_(self.ids))
                        .order_by(WBCheck.id)
                    )
                ).all()
            )
            self.assertEqual(
                [(row.user_id, row.origin) for row in rows],
                [(self.ids[0], "manual"), (self.ids[1], "scheduled")],
            )
