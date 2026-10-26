"""Local PostgreSQL integration tests. Business records are rolled back."""

import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import engine, get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.models.catalog import CatalogOption, Customer, Product, Project
from app.models.ticket import Ticket
from app.models.user import User, UserRole
from app.models.workbench import (
    WBAccount,
    WBAutomation,
    WBDebugEvent,
    WBJob,
    WBMessage,
    WBPreference,
    now,
)
from app.models.workbench_mail import WBMailbox, WBMailFolder
from app.schemas.workbench import Schedule
from app.services import workbench_service as service
from app.services.workbench_schedule import next_slot, working
from tests.workbench_fixtures import create_message


class ScheduleTests(unittest.TestCase):
    def schedule(self, **values):
        return Schedule(enabled=True, **values).model_dump()

    def test_custom_start_interval_and_end(self):
        s = self.schedule(start="08:40", end="17:40", interval_minutes=120)
        t = datetime(2026, 10, 21, 0, 40, tzinfo=timezone.utc)
        self.assertTrue(working(s, t))
        self.assertEqual(next_slot(s, t), t + timedelta(hours=2))
        self.assertFalse(working(s, t - timedelta(minutes=1)))
        self.assertFalse(working(s, t + timedelta(hours=9, minutes=1)))
        self.assertEqual(next_slot(s, t + timedelta(hours=9)), t + timedelta(days=1))

    def test_fifteen_minute_option_and_hour_default(self):
        self.assertEqual(Schedule().interval_minutes, 60)
        s = self.schedule(interval_minutes=15)
        t = datetime(2026, 10, 21, 1, 0, tzinfo=timezone.utc)
        self.assertEqual(next_slot(s, t), t + timedelta(minutes=15))

    def test_configurable_weekdays(self):
        s = self.schedule()
        sat = datetime(2026, 10, 24, 1, tzinfo=timezone.utc)
        self.assertFalse(working(s, sat))
        self.assertTrue(working(s, sat + timedelta(days=2)))
        self.assertEqual(next_slot(s, sat).date().isoformat(), "2026-10-26")
        s["weekdays"].append(5)
        self.assertTrue(working(s, sat))

    def test_disabled_and_invalid(self):
        self.assertIsNone(next_slot(Schedule().model_dump(), now()))
        for values in (
            {"timezone": "Invalid/Zone"},
            {"start": "18:00", "end": "09:00"},
            {"interval_minutes": 90},
            {"weekdays": [9]},
            {"weekdays": []},
        ):
            with self.assertRaises(ValidationError):
                Schedule(**values)

    def test_timezone_and_dst(self):
        s = self.schedule(
            timezone="America/New_York",
            weekdays=list(range(7)),
            start="01:30",
            end="04:30",
            interval_minutes=60,
        )
        # Spring gap: 02:30 does not exist. 03:30 is the next valid local slot.
        t = datetime(2026, 3, 8, 6, 30, tzinfo=timezone.utc)
        self.assertEqual(
            next_slot(s, t), datetime(2026, 3, 8, 7, 30, tzinfo=timezone.utc)
        )
        # Fall fold: both 01:30 instants are real, evaluated on the UTC timeline.
        t = datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc)
        self.assertEqual(
            next_slot(s, t), datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)
        )


class WorkbenchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.connection = await engine.connect()
        self.transaction = await self.connection.begin()
        self.db = AsyncSession(
            bind=self.connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        self.users = [
            User(
                name="Workbench test",
                email=f"{uuid4()}@example.com",
                role=UserRole.engineer,
                password_hash="test-only",
                is_active=True,
            )
            for _ in range(2)
        ]
        self.db.add_all(self.users)
        await self.db.flush()
        self.user = self.users[0]

        async def database():
            yield self.db

        async def current():
            return self.user

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = current
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        response = await self.client.get("/api/v1/workbench")
        self.assertEqual(response.status_code, 200, response.text)
        self.automation = response.json()["automations"][0]
        audit = {"created_by": self.user.id, "updated_by": self.user.id}
        customer = Customer(
            company_name="WB test",
            country_code="CN",
            country_name="China",
            identification_name=str(uuid4()),
            level="KA",
            **audit,
        )
        product = Product(
            identification_name=str(uuid4()),
            type="OTT",
            model="Test",
            chipset="Chip",
            system="OS",
            **audit,
        )
        mailbox = WBMailbox(
            user_id=self.user.id,
            address="test@example.com",
            username="test",
            password_encrypted="encrypted-test",
            imap_host="imap.example.com",
            smtp_host="smtp.example.com",
        )
        self.db.add_all([customer, product, mailbox])
        await self.db.flush()
        self.project = Project(
            number="WB",
            pm="Test",
            start_date=date.today(),
            stage="EV",
            customer_id=customer.id,
            product_id=product.id,
            **audit,
        )
        self.folder = WBMailFolder(mailbox_id=mailbox.id, path="Draco")
        self.db.add_all([self.project, self.folder])
        await self.db.flush()
        response = await self.client.post(
            "/api/v1/workbench/accounts",
            json={
                "name": "客户",
                "platform": "jira",
                "base_url": "https://jira.example.com",
                "username": "fae",
                "password": "secret-test-only",
                "project_id": str(self.project.id),
                "mail_folder_id": str(self.folder.id),
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertNotIn("secret", response.text)
        self.account_id = response.json()["id"]
        self.account = await self.db.get(WBAccount, self.account_id)

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.db.close()
        await self.transaction.rollback()
        await self.connection.close()
        await engine.dispose()

    async def message(self, key_suffix=None):
        message = await create_message(
            self.db, self.account, "FAE-" + key_suffix if key_suffix else "FAE-1"
        )
        await self.db.commit()
        return message

    async def configure(self, steps=None):
        r = await self.client.put(
            "/api/v1/workbench/automations/" + self.automation["id"],
            json={
                "name": "创建工单",
                "steps": steps or [{"type": "read"}, {"type": "result"}],
            },
        )
        self.assertEqual(r.status_code, 200, r.text)

    async def test_manual_checks_are_explicit_and_deduplicated(self):
        from app.models.workbench import WBCheck

        self.assertIsNone(
            (await self.client.get("/api/v1/workbench")).json()["manual_check"]
        )
        first = await self.client.post("/api/v1/workbench/check-updates")
        self.assertEqual(first.status_code, 200, first.text)
        self.assertTrue(first.json()["accepted"])
        ident = first.json()["check"]["id"]
        for status in ("queued", "running"):
            check = await self.db.get(WBCheck, ident)
            check.status = status
            await self.db.commit()
            repeated = (
                await self.client.post("/api/v1/workbench/check-updates")
            ).json()
            self.assertFalse(repeated["accepted"])
            self.assertEqual(repeated["check"]["id"], ident)
        check.status, check.finished_at = "completed", now()
        await self.db.commit()
        self.assertTrue(
            (await self.client.post("/api/v1/workbench/check-updates")).json()[
                "accepted"
            ]
        )
        self.user = self.users[1]
        overview = (await self.client.get("/api/v1/workbench")).json()
        self.assertIsNone(overview["manual_check"])
        self.assertEqual(
            (await self.client.post("/api/v1/workbench/check-updates")).status_code, 422
        )

    async def test_read_note_submit_and_duplicate(self):
        message = await self.message()
        base = "/api/v1/workbench/messages/" + str(message.id)
        self.assertEqual(
            (await self.client.get("/api/v1/workbench")).json()["unread"][
                self.account_id
            ],
            1,
        )
        self.assertEqual((await self.client.post(base + "/read")).status_code, 200)
        overview = (await self.client.get("/api/v1/workbench")).json()
        self.assertEqual(len(overview["messages"]), 1)
        self.assertEqual(overview["unread"], {})
        self.assertEqual(
            (
                await self.client.put(base + "/note", json={"note": "人工补充"})
            ).status_code,
            200,
        )
        # The default Ticket automation inherits the message's hosting project.
        r = await self.client.post(
            base + "/submit",
            json={"automation_id": self.automation["id"]},
            headers={"X-FAE-Locale": "zh-CN"},
        )
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["snapshot"]["project_id"], str(self.project.id))
        self.assertEqual(r.json()["snapshot"]["output_locale"], "zh-CN")
        self.assertEqual(
            next(s["project_id"] for s in r.json()["steps"] if s["type"] == "ticket"),
            str(self.project.id),
        )
        self.assertEqual(r.json()["snapshot"]["note"], "人工补充")
        self.assertEqual(
            (
                await self.client.post(
                    base + "/submit", json={"automation_id": self.automation["id"]}
                )
            ).status_code,
            409,
        )
        overview = (await self.client.get("/api/v1/workbench")).json()
        self.assertEqual(overview["messages"], [])
        self.assertEqual(overview["counts"][self.automation["id"]]["queued"], 1)

    async def test_message_pagination_oldest_first_and_clamp(self):
        instant = now()
        rows = [
            WBMessage(
                user_id=self.user.id,
                account_id=self.account.id,
                payload={"key": str(i), "title": "Pagination", "body": "Test"},
                received_at=instant - timedelta(minutes=40 - i),
                expires_at=instant + timedelta(days=29),
            )
            for i in range(35)
        ]
        self.db.add_all(rows)
        await self.db.commit()
        first = (
            await self.client.get(
                "/api/v1/workbench", params={"account_id": self.account_id}
            )
        ).json()
        last = (
            await self.client.get(
                "/api/v1/workbench", params={"account_id": self.account_id, "page": 99}
            )
        ).json()
        self.assertEqual(first["total_messages"], 35)
        self.assertEqual(
            [m["payload"]["key"] for m in first["messages"]], list(map(str, range(30)))
        )
        self.assertEqual(last["page"], 2)
        self.assertEqual(
            [m["payload"]["key"] for m in last["messages"]],
            list(map(str, range(30, 35))),
        )
        self.assertEqual(
            (
                await self.client.get("/api/v1/workbench", params={"page": 0})
            ).status_code,
            422,
        )

    async def test_message_detail_pages_history_without_duplicated_body(self):
        message = await self.message()
        for _ in range(12):
            self.db.add(
                WBJob(
                    user_id=self.user.id,
                    automation_id=self.automation["id"],
                    message_id=message.id,
                    status="completed",
                    steps=[],
                    snapshot={
                        "payload": message.payload,
                        "note": "Private note",
                        "summary": "Result",
                    },
                    expires_at=message.expires_at,
                )
            )
        await self.db.commit()
        url = f"/api/v1/workbench/messages/{message.id}"
        first = (await self.client.get(url)).json()
        second = (await self.client.get(url, params={"jobs_page": 2})).json()
        self.assertEqual(first["jobs_total"], 12)
        self.assertEqual(len(first["jobs"]), 10)
        self.assertEqual(len(second["jobs"]), 2)
        self.assertEqual(len({j["id"] for j in first["jobs"] + second["jobs"]}), 12)
        self.assertTrue(
            all(j["snapshot"]["payload"]["body"] == "" for j in first["jobs"])
        )
        self.assertEqual(
            (await self.client.get(url, params={"jobs_page": 99})).json()["jobs_page"],
            2,
        )

    async def test_configuration_delete_is_scoped_and_preserves_queued_job(self):
        message = await self.message()
        await self.configure()
        response = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": self.automation["id"]},
        )
        job_id = response.json()["id"]
        self.user = self.users[1]
        for path in (
            f"/accounts/{self.account_id}",
            f"/automations/{self.automation['id']}",
        ):
            self.assertEqual(
                (await self.client.delete("/api/v1/workbench" + path)).status_code, 404
            )
        self.user = self.users[0]
        for path in (
            f"/accounts/{self.account_id}",
            f"/automations/{self.automation['id']}",
        ):
            self.assertEqual(
                (await self.client.delete("/api/v1/workbench" + path)).status_code, 200
            )
        overview = (await self.client.get("/api/v1/workbench")).json()
        self.assertEqual(overview["accounts"], [])
        self.assertNotIn(
            self.automation["id"], [a["id"] for a in overview["automations"]]
        )
        self.assertIsNotNone(await self.db.get(WBMessage, message.id))
        job = await self.db.get(WBJob, job_id)
        self.assertEqual((await service.pick_job(self.db)).id, job.id)
        await service.execute_step(self.db, job, self.user)
        self.assertEqual(job.step_index, 1)
        self.assertEqual(
            (
                await self.client.put(
                    "/api/v1/workbench/order/accounts", json={"ids": []}
                )
            ).status_code,
            200,
        )

    async def test_ticket_target_is_bound_to_message_not_automation_override(self):
        message = await self.message()
        await self.configure([{"type": "ticket", "project_id": str(uuid4())}])
        # Later changes to hosting settings cannot silently redirect an existing message.
        self.account.project_id = None
        await self.db.commit()
        response = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": self.automation["id"]},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(
            response.json()["steps"][0]["project_id"], str(self.project.id)
        )

    async def test_isolation_and_order_validation(self):
        message = await self.message()
        self.user = self.users[1]
        self.assertEqual(
            (await self.client.get("/api/v1/workbench")).json()["accounts"], []
        )
        self.assertEqual(
            (
                await self.client.post(f"/api/v1/workbench/messages/{message.id}/read")
            ).status_code,
            404,
        )
        self.assertEqual(
            (
                await self.client.post(
                    f"/api/v1/workbench/messages/{message.id}/submit",
                    json={"automation_id": self.automation["id"]},
                )
            ).status_code,
            404,
        )
        self.assertEqual(
            (
                await self.client.put(
                    "/api/v1/workbench/order/accounts", json={"ids": [self.account_id]}
                )
            ).status_code,
            409,
        )
        self.user = self.users[0]
        self.assertEqual(
            (
                await self.client.put(
                    "/api/v1/workbench/order/accounts",
                    json={"ids": [self.account_id, self.account_id]},
                )
            ).status_code,
            409,
        )
        self.assertEqual(
            (
                await self.client.put(
                    "/api/v1/workbench/order/accounts", json={"ids": [self.account_id]}
                )
            ).status_code,
            200,
        )

    async def test_history_scoped_pagination_and_retention(self):
        other = WBAutomation(
            user_id=self.user.id, name="Other", kind="custom", steps=[], position=2
        )
        self.db.add(other)
        await self.db.flush()
        instant = now()

        def job(automation_id, **kwargs):
            return WBJob(
                user_id=self.user.id,
                automation_id=automation_id,
                snapshot={
                    "payload": {"title": "History test", "body": "private body"},
                    "note": "private note",
                },
                steps=[],
                status="completed",
                queued_at=instant - timedelta(days=1),
                expires_at=instant + timedelta(days=1),
                **kwargs,
            )

        target_id = self.automation["id"]
        targets = [job(target_id) for _ in range(31)]
        newer = [job(other.id) for _ in range(205)]
        for row in newer:
            row.queued_at = instant
        expired = job(target_id)
        expired.expires_at = instant - timedelta(seconds=1)
        pending = job(target_id)
        pending.expires_at = instant - timedelta(seconds=1)
        pending.status = "queued"
        self.db.add_all([*targets, *newer, expired, pending])
        await self.db.commit()
        url = f"/api/v1/workbench/automations/{target_id}/jobs"
        first = (await self.client.get(url)).json()
        second = (await self.client.get(url, params={"page": 2})).json()
        self.assertEqual(first["total"], 32)
        self.assertEqual(len(first["items"]), 30)
        self.assertEqual(len(second["items"]), 2)
        ids = [j["id"] for j in first["items"] + second["items"]]
        self.assertEqual(len(set(ids)), 32)
        self.assertNotIn(str(expired.id), ids)
        self.assertIn(str(pending.id), ids)
        self.assertEqual(first["items"][0]["snapshot"]["payload"]["body"], "")
        self.assertEqual(
            (await self.client.get(url, params={"page": 0})).status_code, 422
        )
        self.user = self.users[1]
        self.assertEqual((await self.client.get(url)).status_code, 404)

    async def test_dismiss_message_is_scoped_and_does_not_return(self):
        message = await self.message()
        url = f"/api/v1/workbench/messages/{message.id}"
        self.user = self.users[1]
        self.assertEqual((await self.client.post(url + "/dismiss")).status_code, 404)
        self.user = self.users[0]
        self.assertEqual((await self.client.post(url + "/dismiss")).status_code, 200)
        self.assertEqual((await self.client.post(url + "/dismiss")).status_code, 200)
        result = (await self.client.get("/api/v1/workbench")).json()
        self.assertEqual(result["messages"], [])
        self.assertEqual(result["unread"], {})
        self.assertEqual(result["total_messages"], 0)
        self.assertEqual((await self.client.post(url + "/read")).status_code, 200)
        self.assertEqual(
            (await self.client.put(url + "/note", json={"note": "x"})).status_code, 409
        )
        self.assertEqual(
            (
                await self.client.post(
                    url + "/submit", json={"automation_id": self.automation["id"]}
                )
            ).status_code,
            409,
        )
        await self.db.commit()
        self.assertEqual(
            (await self.client.get("/api/v1/workbench")).json()["messages"], []
        )
        await self.db.refresh(message)
        self.assertTrue(message.dismissed)

    async def test_dismiss_preserves_submitted_job(self):
        message = await self.message()
        await self.configure()
        url = f"/api/v1/workbench/messages/{message.id}"
        self.assertEqual(
            (
                await self.client.post(
                    url + "/submit", json={"automation_id": self.automation["id"]}
                )
            ).status_code,
            201,
        )
        self.assertEqual((await self.client.post(url + "/dismiss")).status_code, 200)
        self.assertTrue(message.submitted)

    async def test_tapd_unavailable_and_http_url_rejected(self):
        message = await self.message()
        overview = (await self.client.get("/api/v1/workbench")).json()
        tapd = next(a for a in overview["automations"] if a["kind"] == "tapd")
        r = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": tapd["id"]},
        )
        self.assertEqual(r.status_code, 409)
        r = await self.client.post(
            "/api/v1/workbench/accounts",
            json={
                "name": "bad",
                "platform": "jira",
                "base_url": "http://example.com",
                "username": "x",
                "password": "x",
            },
        )
        self.assertEqual(r.status_code, 422)

    async def test_platform_hosts_do_not_require_environment_allowlists(self):
        for platform in ("jira", "youtrack"):
            response = await self.client.post(
                "/api/v1/workbench/accounts",
                json={
                    "name": "Custom platform",
                    "platform": platform,
                    "base_url": "https://custom.example.com:9443",
                    "username": "test",
                    "password": "test-only",
                    "project_id": str(self.project.id),
                    "mail_folder_id": str(self.folder.id),
                },
            )
            self.assertEqual(response.status_code, 201, response.text)
        from app.services.jira_client import JiraClient

        account = await self.db.get(WBAccount, self.account_id)
        account.base_url = "https://custom.example.com:9443"
        async with JiraClient(account) as client:
            self.assertEqual(
                str(client.client.base_url), "https://custom.example.com:9443/"
            )

    async def test_disabled_schedule_preserves_explicit_timezone(self):
        settings = Schedule(
            enabled=False,
            timezone="America/New_York",
            start="08:40",
            end="17:40",
            interval_minutes=120,
        ).model_dump()
        r = await self.client.put(
            "/api/v1/workbench/schedule",
            json=settings,
            headers={"X-FAE-Locale": "zh-CN"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        overview = (await self.client.get("/api/v1/workbench")).json()
        self.assertTrue(overview["schedule_configured"])
        self.assertEqual(overview["schedule"], settings)
        self.assertIsNone(overview["next_run_at"])
        pref = await self.db.get(WBPreference, self.user.id)
        self.assertEqual(pref.schedule["output_locale"], "zh-CN")
        # Merely visiting in English cannot mutate scheduled output language.
        await self.client.get("/api/v1/workbench", headers={"X-FAE-Locale": "en"})
        await self.db.refresh(pref)
        self.assertEqual(pref.schedule["output_locale"], "zh-CN")

    async def test_raw_debug_output_cursor_isolation_and_expiry(self):
        outputs = ["raw\n  preserved spacing\n", "second chunk"]
        for output in outputs:
            self.db.add(
                WBDebugEvent(
                    user_id=self.user.id,
                    output=output,
                    expires_at=now() + timedelta(days=30),
                )
            )
        self.db.add(
            WBDebugEvent(
                user_id=self.user.id,
                output="expired",
                expires_at=now() - timedelta(seconds=1),
            )
        )
        self.db.add(
            WBDebugEvent(
                user_id=self.users[1].id,
                output="private",
                expires_at=now() + timedelta(days=30),
            )
        )
        await self.db.commit()
        r = await self.client.get("/api/v1/workbench/debug")
        self.assertEqual(r.status_code, 200, r.text)
        events = r.json()["events"]
        self.assertEqual([e["output"] for e in events], outputs)
        r = await self.client.get(
            "/api/v1/workbench/debug", params={"after": events[0]["id"]}
        )
        self.assertEqual([e["output"] for e in r.json()["events"]], outputs[1:])
        await service.cleanup(self.db)
        await self.db.commit()
        self.assertIsNone(
            await self.db.scalar(
                select(WBDebugEvent.id).where(
                    WBDebugEvent.user_id == self.user.id,
                    WBDebugEvent.output == "expired",
                )
            )
        )

    async def test_ai_stream_preserves_raw_chunks_before_completion(self):
        await self.configure([{"type": "ai", "instruction": "整理"}])
        message = await self.message()
        r = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": self.automation["id"]},
        )
        job = await self.db.get(WBJob, r.json()["id"])
        first = "raw\n  " + ("x" * 2100)
        emitted = AsyncMock()

        async def chunks(*args, **kwargs):
            yield first
            # The first chunk must be published before the upstream iterator completes.
            emitted.assert_awaited_once_with(self.user.id, first)
            yield "\nlast line"

        with (
            patch.object(service, "stream", chunks),
            patch.object(service, "emit", emitted),
        ):
            await service.execute_step(self.db, job, self.user)
        self.assertEqual(job.snapshot["summary"], first + "\nlast line")
        self.assertEqual(
            "".join(c.args[1] for c in emitted.await_args_list), first + "\nlast line"
        )

    async def test_debug_cache_and_response_are_bounded(self):
        from app.services.workbench_limits import (
            MAX_DEBUG_EVENTS,
            MAX_DEBUG_RESPONSE_CHARS,
        )

        for _ in range(MAX_DEBUG_EVENTS + 10):
            self.db.add(
                WBDebugEvent(
                    user_id=self.user.id,
                    output="x" * 16000,
                    expires_at=now() + timedelta(days=30),
                )
            )
        await self.db.commit()
        await service.cleanup(self.db)
        await self.db.commit()
        count = await self.db.scalar(
            select(func.count())
            .select_from(WBDebugEvent)
            .where(WBDebugEvent.user_id == self.user.id)
        )
        self.assertEqual(count, MAX_DEBUG_EVENTS)
        first = (await self.client.get("/api/v1/workbench/debug")).json()["events"]
        self.assertLessEqual(
            sum(len(e["output"]) for e in first), MAX_DEBUG_RESPONSE_CHARS
        )
        after = (
            await self.client.get(
                "/api/v1/workbench/debug", params={"after": first[0]["id"]}
            )
        ).json()["events"]
        self.assertLessEqual(
            sum(len(e["output"]) for e in after), MAX_DEBUG_RESPONSE_CHARS
        )

    async def test_ai_response_limit_stops_unbounded_accumulation(self):
        from fastapi import HTTPException

        from app.services.workbench_limits import MAX_AI_RESPONSE_CHARS

        await self.configure([{"type": "ai"}])
        message = await self.message()
        result = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": self.automation["id"]},
        )
        job = await self.db.get(WBJob, result.json()["id"])

        async def chunks(*args, **kwargs):
            yield "x" * MAX_AI_RESPONSE_CHARS
            yield "overflow"

        with (
            patch.object(service, "stream", chunks),
            patch.object(service, "emit", AsyncMock()),
        ):
            with self.assertRaises(HTTPException):
                await service.execute_step(self.db, job, self.user)
        self.assertEqual(job.step_index, 0)

    async def test_retry_preserves_checkpoint_and_moves_to_tail(self):
        message = await self.message()
        await self.configure()
        r = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": self.automation["id"]},
        )
        job = await self.db.get(WBJob, r.json()["id"])
        await service.execute_step(self.db, job, self.user)
        job.status = "failed"
        job.error = "failure"
        await self.db.commit()
        previous = job.queued_at
        r = await self.client.post(f"/api/v1/workbench/jobs/{job.id}/retry")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["step_index"], 1)
        self.assertGreater(job.queued_at, previous)
        self.assertEqual(job.status, "queued")
        self.assertEqual(
            (
                await self.client.post(f"/api/v1/workbench/jobs/{job.id}/retry")
            ).status_code,
            409,
        )

    async def test_real_ticket_atomic_checkpoint(self):
        await self.db.execute(
            insert(CatalogOption)
            .values(category="project_pm", value="WB PM")
            .on_conflict_do_nothing()
        )
        c = await self.client.post(
            "/api/v1/catalog/customers",
            json={"company_name": "WB company", "country_code": "CN", "level": "KA"},
        )
        p = await self.client.post(
            "/api/v1/catalog/products",
            json={"type": "OTT", "model": "WBModel", "chipset": "Chip", "system": "OS"},
        )
        project = await self.client.post(
            "/api/v1/catalog/projects",
            json={
                "number": "WB",
                "pm": "WB PM",
                "start_date": "2026-09-01",
                "stage": "EV",
                "customer_id": c.json()["id"],
                "product_id": p.json()["id"],
            },
        )
        self.assertEqual(project.status_code, 201, project.text)
        await self.configure([{"type": "ticket", "project_id": project.json()["id"]}])
        message = await self.message()
        r = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": self.automation["id"]},
        )
        job = await self.db.get(WBJob, r.json()["id"])
        await service.execute_step(self.db, job, self.user)
        self.assertIsNotNone(job.ticket_id)
        ticket = await self.db.get(Ticket, job.ticket_id)
        self.assertEqual(ticket.raw_report, "原始反馈")
        job.step_index = (
            0  # Simulate an externally-requested replay: idempotency guard remains.
        )
        await service.execute_step(self.db, job, self.user)
        self.assertEqual(
            await self.db.scalar(
                select(func.count())
                .select_from(Ticket)
                .where(Ticket.creator_id == self.user.id)
            ),
            1,
        )

    async def test_round_robin_fifo_and_crash_recovery(self):
        await self.configure()
        r = await self.client.post(
            "/api/v1/workbench/automations",
            json={"name": "第二任务", "steps": [{"type": "read"}]},
        )
        other = r.json()["id"]
        ids = []
        for version, task in [
            ("a", self.automation["id"]),
            ("b", self.automation["id"]),
            ("c", other),
        ]:
            m = await self.message(version)
            r = await self.client.post(
                f"/api/v1/workbench/messages/{m.id}/submit",
                json={"automation_id": task},
            )
            self.assertEqual(r.status_code, 201, r.text)
            ids.append(r.json()["id"])
        first = await service.pick_job(self.db)
        self.assertEqual(str(first.id), ids[0])
        first.status = "failed"
        await self.db.commit()
        second = await service.pick_job(self.db)
        self.assertEqual(str(second.id), ids[2])
        second.status = "running"
        await service.execute_step(self.db, second, self.user)
        # A restarted worker resumes the running job before choosing another card.
        self.assertEqual((await service.pick_job(self.db)).id, second.id)
        self.assertEqual(second.step_index, 1)
        second.status = "completed"
        await self.db.commit()
        third = await service.pick_job(self.db)
        self.assertEqual(str(third.id), ids[1])

    async def test_active_input_survives_payload_cleanup(self):
        await self.configure()
        message = await self.message()
        r = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": self.automation["id"]},
        )
        job_id = r.json()["id"]
        message.expires_at = now() - timedelta(seconds=1)
        await self.db.commit()
        await service.cleanup(self.db)
        await self.db.commit()
        job = await self.db.get(WBJob, job_id)
        await self.db.refresh(job)
        self.assertEqual(job.message_id, message.id)
        self.assertEqual(job.snapshot["payload"]["body"], "原始反馈")
        await service.execute_step(self.db, job, self.user)
        self.assertEqual(job.step_index, 1)
