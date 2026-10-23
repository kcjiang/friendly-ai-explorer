"""Opt-in smoke test against a running workbench-worker; only its own test user is removed."""

import asyncio
import os
import unittest
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, engine
from app.models.user import User, UserRole
from app.models.workbench import (
    WBAccount,
    WBAutomation,
    WBCheck,
    WBJob,
    WBMessage,
    WBPreference,
    now,
)
from app.schemas.workbench import Schedule
from app.services.workbench_checks import enqueue_manual
from app.services.workbench_service import initialize


@unittest.skipUnless(
    os.environ.get("WORKBENCH_WORKER_TEST") == "1",
    "Requires an explicitly enabled local workbench-worker smoke test",
)
class WorkerSmokeTests(unittest.IsolatedAsyncioTestCase):
    async def test_manual_check_runs_without_enabling_a_schedule(self):
        ident = uuid4()
        try:
            async with AsyncSessionLocal() as db:
                db.add(
                    User(
                        id=ident,
                        name="Disposable manual check",
                        email=f"{ident}@example.invalid",
                        password_hash="not-a-login",
                        role=UserRole.engineer,
                        is_active=True,
                    )
                )
                await db.flush()
                pref = await initialize(db, ident)
                self.assertFalse(pref.schedule["enabled"])
                result = await enqueue_manual(db, ident)
                check_id = result["check"]["id"]
                await db.commit()
            for _ in range(40):
                async with AsyncSessionLocal() as db:
                    check = await db.get(WBCheck, check_id)
                    if check.status == "completed":
                        self.assertIsNotNone(check.started_at)
                        self.assertIsNotNone(check.finished_at)
                        return
                    self.assertNotEqual(check.status, "failed", check.error)
                await asyncio.sleep(0.5)
            self.fail(
                "Worker did not process the manual check with scheduling disabled"
            )
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(delete(User).where(User.id == ident))
                await db.commit()
            await engine.dispose()

    async def test_collection_failure_continues_to_next_platform(self):
        ident = uuid4()
        try:
            async with AsyncSessionLocal() as db:
                db.add(
                    User(
                        id=ident,
                        name="Disposable collector test",
                        email=f"{ident}@example.invalid",
                        password_hash="not-a-login",
                        role=UserRole.engineer,
                        is_active=True,
                    )
                )
                await db.flush()
                pref = await initialize(db, ident)
                zone = "Etc/GMT+12" if now().hour >= 12 else "UTC"
                pref.schedule = Schedule(
                    enabled=True,
                    timezone=zone,
                    weekdays=list(range(7)),
                    start="00:00",
                    end="23:59",
                ).model_dump()
                pref.next_run_at = now() - timedelta(seconds=1)
                for position in range(2):
                    # Missing project/folder binding: failure occurs before any network access.
                    db.add(
                        WBAccount(
                            user_id=ident,
                            name="Disposable unconfigured source",
                            platform="jira",
                            base_url="https://workbench-test-unconfigured.invalid",
                            username="test",
                            password_encrypted="test-only",
                            position=position,
                            enabled=True,
                        )
                    )
                await db.commit()
            for _ in range(40):
                async with AsyncSessionLocal() as db:
                    accounts = list(
                        (
                            await db.scalars(
                                select(WBAccount).where(WBAccount.user_id == ident)
                            )
                        ).all()
                    )
                    if len(accounts) == 2 and all(
                        a.status == "failed" for a in accounts
                    ):
                        self.assertTrue(
                            all("链接邮件文件夹" in a.error for a in accounts)
                        )
                        self.assertTrue(all(a.last_run_at for a in accounts))
                        return
                await asyncio.sleep(0.5)
            self.fail("Collector did not process both platforms after the first failed")
        finally:
            async with AsyncSessionLocal() as db:
                for model in (
                    WBJob,
                    WBMessage,
                    WBAccount,
                    WBAutomation,
                    WBPreference,
                ):
                    await db.execute(delete(model).where(model.user_id == ident))
                await db.execute(delete(User).where(User.id == ident))
                await db.commit()
            await engine.dispose()

    async def test_background_failure_does_not_block_next_job(self):
        ident = uuid4()
        failed_id, success_id = uuid4(), uuid4()
        try:
            async with AsyncSessionLocal() as db:
                db.add(
                    User(
                        id=ident,
                        name="Disposable workbench worker test",
                        email=f"{ident}@example.invalid",
                        password_hash="not-a-login",
                        role=UserRole.engineer,
                        is_active=True,
                    )
                )
                await db.flush()
                await initialize(db, ident)
                automation = await db.scalar(
                    select(WBAutomation).where(
                        WBAutomation.user_id == ident, WBAutomation.kind == "ticket"
                    )
                )
                snapshot = {
                    "payload": {
                        "key": "WORKER-TEST",
                        "title": "Disposable worker test",
                        "body": "Test only",
                        "url": "",
                    },
                    "note": "",
                    "platform": "jira",
                    "account_name": "Disposable test",
                }
                for job_id, steps in [
                    (failed_id, [{"type": "invalid"}]),
                    (success_id, [{"type": "read"}, {"type": "result"}]),
                ]:
                    db.add(
                        WBJob(
                            id=job_id,
                            user_id=ident,
                            automation_id=automation.id,
                            snapshot=snapshot,
                            steps=steps,
                            status="queued",
                            expires_at=now() + timedelta(days=30),
                        )
                    )
                await db.commit()
            for _ in range(40):
                async with AsyncSessionLocal() as db:
                    statuses = dict(
                        (
                            await db.execute(
                                select(WBJob.id, WBJob.status).where(
                                    WBJob.user_id == ident
                                )
                            )
                        ).all()
                    )
                    if (
                        statuses.get(failed_id) == "failed"
                        and statuses.get(success_id) == "completed"
                    ):
                        job = await db.get(WBJob, success_id)
                        self.assertEqual(job.step_index, 2)
                        self.assertEqual(len(job.logs), 2)
                        failed = await db.get(WBJob, failed_id)
                        self.assertIn("不支持", failed.error)
                        return
                await asyncio.sleep(0.5)
            self.fail(f"Worker did not finish test jobs: {statuses}")
        finally:
            async with AsyncSessionLocal() as db:
                # Explicit child-first removal, scoped strictly to the generated disposable UUID.
                for model in (
                    WBJob,
                    WBMessage,
                    WBAccount,
                    WBAutomation,
                    WBPreference,
                ):
                    await db.execute(delete(model).where(model.user_id == ident))
                await db.execute(delete(User).where(User.id == ident))
                await db.commit()
            await engine.dispose()
