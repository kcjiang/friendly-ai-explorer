"""Mailbox protocol safety and mail-driven lifecycle; no real messages are sent."""

import unittest
from datetime import timedelta
from email.message import EmailMessage
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from sqlalchemy import func, select

from app.models.workbench import WBAccount, WBJob, WBMessage, now
from app.models.workbench_mail import WBMail, WBMailbox, WBMailLocation, WBMessageMail
from app.services import workbench_collection as sources
from app.services import workbench_mail_protocol as protocol
from app.services import workbench_mail_service as mail_service
from app.security import encrypt_credential
from tests import test_workbench as workbench_tests


def encrypt(value):
    return encrypt_credential(value, "mail")


class ProtocolTests(unittest.TestCase):
    def test_noselect_flags_are_case_insensitive(self):
        client = Mock()
        client.list.return_value = (
            "OK",
            [
                b'(\\NoSelect \\HasChildren) "/" "Virtual"',
                b'(\\Noselect) "/" "Virtual2"',
                b'(\\NOSELECT) "/" "Virtual3"',
                b'(\\HasNoChildren) "/" "INBOX"',
            ],
        )
        rows = protocol.folders(client)
        self.assertEqual(
            [row["selectable"] for row in rows], [False, False, False, True]
        )

    def test_missing_validity_uses_status_or_fails_safely(self):
        client = Mock()
        client.response.return_value = ("UIDVALIDITY", [None])
        client.status.return_value = ("OK", [b'"INBOX" (UIDVALIDITY 72)'])
        self.assertEqual(protocol.folder_validity(client, "INBOX"), "72")
        client.status.return_value = ("OK", [b'"Virtual" ()'])
        with self.assertRaisesRegex(protocol.MailProtocolError, "UIDVALIDITY"):
            protocol.folder_validity(client, "Virtual")

    def test_utf7_and_subject_sender_rule(self):
        name = "客户/Draco & Test"
        self.assertEqual(protocol.folder_text(protocol.folder_wire(name)[1:-1]), name)
        rule = {"sender": "jira@sdmctech.com", "keywords": ["DRACO-"]}
        self.assertTrue(
            protocol.matches(
                rule,
                {
                    "sender": "Jack (Jira) <jira@sdmctech.com>",
                    "subject": "Updates DRACO-43",
                },
            )
        )
        self.assertFalse(
            protocol.matches(
                rule, {"sender": "fake@elsewhere.com", "subject": "DRACO-43"}
            )
        )

    def test_peek_and_internaldate_cutoff(self):
        client = Mock()
        client.list.return_value = ("OK", [b'(\\HasNoChildren) "/" "INBOX"'])
        client.select.return_value = ("OK", [b"2"])
        client.response.return_value = ("UIDVALIDITY", [b"1"])
        raw = b"Message-ID: <m1@test>\r\nSubject: DRACO-43\r\n\r\nhello"
        cutoff = now() - timedelta(days=30)
        fresh = now().strftime("%d-%b-%Y %H:%M:%S +0000").encode()
        old = (cutoff - timedelta(days=1)).strftime("%d-%b-%Y %H:%M:%S +0000").encode()

        def uid(command, *args):
            if command.lower() == "search":
                return "OK", [b"1 2"]
            if args[-1] == "(UID FLAGS INTERNALDATE)":
                return "OK", [
                    b'1 (UID 1 FLAGS () INTERNALDATE "' + fresh + b'")',
                    b'2 (UID 2 FLAGS (\\Seen) INTERNALDATE "' + old + b'")',
                ]
            self.assertEqual(args[-1], "(BODY.PEEK[])")
            return "OK", [(b"1 BODY[]", raw)]

        client.uid.side_effect = uid
        folders, rows = protocol.read_snapshot(client, {}, cutoff)
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["is_read"])
        self.assertFalse(
            any(call.args[0].lower() == "store" for call in client.uid.call_args_list)
        )
        self.assertTrue(client.select.call_args.kwargs["readonly"])

    def test_move_never_marks_seen_or_global_expunge(self):
        client = Mock()
        client.select.return_value = ("OK", [])
        client.capabilities = (b"UIDPLUS",)
        client.uid.return_value = ("OK", [])
        protocol.move(client, "INBOX", "7", "Draco")
        calls = [call.args for call in client.uid.call_args_list]
        self.assertEqual([call[0] for call in calls], ["COPY", "STORE", "EXPUNGE"])
        self.assertEqual(calls[-1], ("EXPUNGE", "7"))
        self.assertNotIn("\\Seen", str(calls))

    def test_move_accepts_real_imaplib_string_capabilities(self):
        for capabilities in [
            ("IMAP4REV1", "MOVE", "UIDPLUS"),
            (b"IMAP4REV1", b"MOVE", b"UIDPLUS"),
        ]:
            client = Mock()
            client.select.return_value = ("OK", [])
            client.capabilities = capabilities
            client.uid.return_value = ("OK", [])
            protocol.move(client, "INBOX", "7", "Draco")
            client.uid.assert_called_once_with("MOVE", "7", '"Draco"')

    def test_read_explicitly_sets_seen(self):
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock()
        client.select.return_value = ("OK", [])
        client.response.return_value = ("UIDVALIDITY", [b"1"])
        client.uid.return_value = ("OK", [])
        with patch.object(protocol, "connect", return_value=client):
            protocol.mark_read({}, [{"folder": "Draco", "validity": "1", "uid": "2"}])
        client.uid.assert_called_once_with("STORE", "2", "+FLAGS.SILENT", "(\\Seen)")

    def test_first_classification_move_keeps_original_receipt_time(self):
        received = now() - timedelta(days=20)
        original = {
            "source_key": "key",
            "sender": "jira@example.com",
            "subject": "DRACO-43",
            "folder": "INBOX",
            "uid": "1",
            "validity": "1",
            "received_at": received,
            "is_read": False,
        }
        moved = {**original, "folder": "Draco", "uid": "9", "received_at": now()}
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock()
        with (
            patch.object(protocol, "connect", return_value=client),
            patch.object(
                protocol, "read_snapshot", side_effect=[([], [original]), ([], [moved])]
            ),
            patch.object(protocol, "move") as move,
        ):
            _, rows = protocol.sync(
                {},
                {},
                [
                    {
                        "id": uuid4(),
                        "sender": "jira@example.com",
                        "keywords": ["DRACO-"],
                        "destination": "Draco",
                    }
                ],
                now() - timedelta(days=30),
            )
        move.assert_called_once()
        self.assertEqual(rows[0]["received_at"], received)
        self.assertFalse(rows[0]["is_read"])

    def test_smtp_html_alternative_bcc_and_sent_copy(self):
        smtp = Mock()
        smtp.__enter__ = Mock(return_value=smtp)
        smtp.__exit__ = Mock()
        smtp.sendmail.return_value = {}
        imap = Mock()
        imap.__enter__ = Mock(return_value=imap)
        imap.__exit__ = Mock()
        imap.append.return_value = ("OK", [])
        config = {
            "address": "fae@example.com",
            "username": "fae",
            "password": "test",
            "smtp_host": "smtp.example.com",
            "smtp_port": 465,
            "smtp_security": "ssl",
        }
        body = {
            "to": ["to@example.com"],
            "cc": [],
            "bcc": ["hidden@example.com"],
            "subject": "Test",
            "html": "<p><strong>Hello</strong></p>",
            "text": "Hello",
            "attachments": [],
        }
        with (
            patch.object(protocol.smtplib, "SMTP_SSL", return_value=smtp),
            patch.object(protocol, "connect", return_value=imap),
        ):
            protocol.send(config, body, "Sent")
        raw = smtp.sendmail.call_args.args[2]
        self.assertIn(b"text/html", raw)
        self.assertIn(b"text/plain", raw)
        self.assertNotIn(b"Bcc:", raw)
        self.assertIn("hidden@example.com", smtp.sendmail.call_args.args[1])
        imap.append.assert_called_once()

    def test_html_and_issue_link_filtering(self):
        parser = mail_service.SafeHTML()
        parser.feed(
            '<script>secret()</script><a href="javascript:alert(1)" onclick="bad()">ok</a><img src="https://tracker">'
        )
        output = "".join(parser.output)
        self.assertEqual(output, "<a>ok</a>")
        account = SimpleNamespace(base_url="https://jira.example.com", platform="jira")
        mail = SimpleNamespace(
            subject="DRACO-43",
            body_text="https://evil.example/browse/DRACO-43 https://jira.example.com/browse/OTHER-2 https://jira.example.com/browse/DRACO-43",
            body_html="",
        )
        self.assertEqual(sources.issue_key(account, mail), "DRACO-43")
        mail.body_text = "https://jira.example.com.evil/browse/DRACO-43"
        self.assertIsNone(sources.issue_key(account, mail))

    def test_email_stylesheets_tables_and_font_layout_survive(self):
        parser = mail_service.SafeHTML()
        parser.feed(
            '<html><head><style>.ticket {background-color:#eef; color:rgb(1,2,3); padding:12px; width:600px} @media(max-width:600px){.ticket{width:100%}} @import "https://tracker.test/css";</style></head><body><table class="ticket" width="600" cellpadding="8" bgcolor="#eeeeff"><tr><td align="center"><font color="#112233" face="Arial">Report</font></td></tr></table></body></html>'
        )
        output = "".join(parser.output)
        for retained in (
            "<style>",
            ".ticket",
            "rgb(1,2,3)",
            "@media",
            'class="ticket"',
            'width="600"',
            'cellpadding="8"',
            'bgcolor="#eeeeff"',
            'align="center"',
            "<font",
        ):
            self.assertIn(retained, output)
        self.assertNotIn("tracker.test", output)

    def test_html_active_content_and_css_network_requests_are_removed(self):
        parser = mail_service.SafeHTML()
        parser.feed(
            '<style>.x{color:red;background:url(https://tracker.test/image);width:expression(alert(1))}</style><p class="x" onclick="bad()" style="background:u\\72l(https://tracker.test);color:blue">Safe</p><iframe src="https://tracker.test">hidden</iframe><script>secret()</script>'
        )
        output = "".join(parser.output)
        self.assertIn("color:red", output)
        self.assertIn("color:blue", output)
        for removed in (
            "tracker.test",
            "onclick",
            "expression",
            "secret()",
            "iframe",
            "hidden",
        ):
            self.assertNotIn(removed, output)

    def test_remote_images_are_inert_until_explicitly_enabled(self):
        parser = mail_service.SafeHTML(preserve_remote=True)
        parser.feed(
            '<img src="https://example.com/banner.png" alt="Banner"><img src="javascript:bad()">'
        )
        output = "".join(parser.output)
        self.assertTrue(parser.has_remote_images)
        self.assertIn('data-remote-src="https://example.com/banner.png"', output)
        self.assertNotIn(' src="', output)
        self.assertNotIn("javascript:", output)


class MailLifecycleTests(unittest.IsolatedAsyncioTestCase):
    configure = workbench_tests.WorkbenchTests.configure

    async def asyncSetUp(self):
        await workbench_tests.WorkbenchTests.asyncSetUp(self)
        self.account.mail_folder_id, self.account.project_id = (
            self.folder.id,
            self.project.id,
        )
        self.box = await self.db.get(WBMailbox, self.folder.mailbox_id)
        self.box.password_encrypted = encrypt("secret-test-only")

    async def asyncTearDown(self):
        await workbench_tests.WorkbenchTests.asyncTearDown(self)

    async def test_mail_servers_need_no_allowlist_and_still_require_tls(self):
        from fastapi import HTTPException

        settings = mail_service.config(self.box)
        self.assertEqual(settings["imap_host"], "imap.example.com")
        self.assertEqual(settings["smtp_host"], "smtp.example.com")
        self.assertTrue(settings["password"])
        self.box.imap_security = "plain"
        with self.assertRaises(HTTPException):
            mail_service.config(self.box)

    async def incoming(self, age=1):
        raw = EmailMessage()
        raw["Subject"] = "Updates for DRACO-43"
        raw["From"] = "Jira <jira@example.com>"
        raw["Message-ID"] = f"<{uuid4()}@example.com>"
        raw.set_content("https://jira.example.com/browse/DRACO-43")
        timestamp = now() - timedelta(days=age)
        mail = WBMail(
            mailbox_id=self.box.id,
            **protocol.parse_mail(raw.as_bytes()),
            received_at=timestamp,
            expires_at=timestamp + timedelta(days=30),
            is_read=False,
        )
        self.db.add(mail)
        await self.db.flush()
        self.db.add(
            WBMailLocation(
                mail_id=mail.id,
                folder_id=self.folder.id,
                validity="1",
                uid=str(uuid4().int)[:10],
                is_read=False,
            )
        )
        await self.db.commit()
        return mail

    async def collect(self):
        from unittest.mock import AsyncMock

        with patch.object(
            sources,
            "payload",
            AsyncMock(
                return_value={
                    "key": "DRACO-43",
                    "title": "Issue",
                    "body": "Current details",
                    "url": "https://jira.example.com/browse/DRACO-43",
                }
            ),
        ):
            await sources.collect(self.db, self.account)
            await self.db.commit()
        return await self.db.scalar(
            select(WBMessage).where(
                WBMessage.account_id == self.account.id,
                WBMessage.source_key == "DRACO-43",
            )
        )

    async def test_mail_driven_pending_processed_inflight_and_failed_update(self):
        first = await self.incoming(age=20)
        message = await self.collect()
        original_expiry = message.expires_at
        self.assertEqual(message.received_at, first.received_at)
        self.assertFalse(message.is_read)
        await self.collect()
        self.assertEqual(message.expires_at, original_expiry)
        await self.configure()
        response = await self.client.post(
            f"/api/v1/workbench/messages/{message.id}/submit",
            json={"automation_id": self.automation["id"]},
        )
        job = await self.db.get(WBJob, response.json()["id"])
        self.assertTrue(message.submitted)
        second = await self.incoming(age=1)
        await self.collect()
        self.assertTrue(message.submitted)
        self.assertTrue(message.is_read)
        self.assertEqual(job.expires_at, second.expires_at)
        job.status = "failed"
        await sources.finish(self.db, job)
        await self.db.commit()
        self.assertFalse(message.submitted)
        self.assertFalse(message.is_read)
        detail = (
            await self.client.post(f"/api/v1/workbench/messages/{message.id}/read")
        ).json()
        self.assertEqual(len(detail["mails"]), 2)
        self.assertEqual(len(detail["jobs"]), 1)
        self.assertFalse(first.is_read)
        self.assertFalse(second.is_read)
        self.assertEqual(
            (
                await self.client.post(f"/api/v1/workbench/jobs/{job.id}/retry")
            ).status_code,
            200,
        )
        self.assertTrue(message.submitted)

    async def test_resource_timestamp_skips_older_mail_and_keeps_latest_origin(self):
        from unittest.mock import AsyncMock

        first = await self.incoming(age=10)
        message = await self.collect()
        self.assertEqual(message.resource_updated_at, first.received_at)
        self.assertEqual(message.resource_source["mail_id"], str(first.id))
        message.is_read, message.submitted = True, True
        revision = message.revision
        old = await self.incoming(age=20)
        with patch.object(sources, "payload", AsyncMock()) as fetch:
            await sources.collect(self.db, self.account)
            await self.db.commit()
            fetch.assert_not_awaited()
        self.assertEqual(message.revision, revision)
        self.assertTrue(message.is_read)
        self.assertTrue(message.submitted)
        self.assertEqual(message.resource_source["mail_id"], str(first.id))
        self.assertIsNotNone(
            await self.db.scalar(
                select(WBMessageMail).where(WBMessageMail.mail_id == old.id)
            )
        )
        # A fetched source can be newer than its notification. Receipt still controls TTL.
        newest = await self.incoming(age=2)
        updated = now() - timedelta(days=1)
        data = {
            "key": "DRACO-43",
            "title": "Updated",
            "body": "New details",
            "url": "https://jira.example.com/browse/DRACO-43",
            "updated_at": updated.isoformat(),
        }
        with patch.object(sources, "payload", AsyncMock(return_value=data)):
            await sources.collect(self.db, self.account)
            await self.db.commit()
        self.assertEqual(message.resource_updated_at, updated)
        self.assertEqual(message.expires_at, newest.expires_at)
        self.assertFalse(message.submitted)
        self.assertFalse(message.is_read)
        self.assertEqual(message.resource_source["mail_id"], str(newest.id))
        await self.incoming(age=1.5)
        with patch.object(sources, "payload", AsyncMock()) as fetch:
            await sources.collect(self.db, self.account)
            await self.db.commit()
            fetch.assert_not_awaited()

    async def test_issue_collection_orders_by_latest_mail_oldest_first(self):
        from unittest.mock import AsyncMock

        await self.incoming(age=1)
        oldest = await self.incoming(age=20)
        oldest.subject = "Updates for DRACO-42"
        oldest.body_text = "https://jira.example.com/browse/DRACO-42"
        await self.db.commit()

        async def data(account, key):
            return {"key": key, "title": "Issue", "body": "Test", "url": ""}

        with patch.object(sources, "payload", AsyncMock(side_effect=data)) as fetch:
            await sources.collect(self.db, self.account)
            await self.db.commit()
            self.assertEqual(
                [c.args[1] for c in fetch.await_args_list], ["DRACO-42", "DRACO-43"]
            )

    async def test_failed_resource_preserves_other_successes_and_continues(self):
        from unittest.mock import AsyncMock

        from fastapi import HTTPException

        user_id = self.user.id
        for age, key in [(20, "DRACO-40"), (10, "DRACO-41"), (1, "DRACO-42")]:
            mail = await self.incoming(age=age)
            mail.subject = "Updates for " + key
            mail.body_text = "https://jira.example.com/browse/" + key
        await self.db.commit()

        async def fetch(account, key):
            if key == "DRACO-41":
                raise HTTPException(502, "Test failure")
            return {"key": key, "title": "Test", "body": "Test", "url": ""}

        with patch.object(sources, "payload", AsyncMock(side_effect=fetch)):
            with self.assertRaises(HTTPException):
                await sources.collect(self.db, self.account)
        # Simulate the caller's rollback after an account reports partial failure.
        await self.db.rollback()
        keys = set(
            (
                await self.db.scalars(
                    select(WBMessage.source_key).where(WBMessage.user_id == user_id)
                )
            ).all()
        )
        self.assertIn("DRACO-40", keys)
        self.assertIn("DRACO-42", keys)
        self.assertNotIn("DRACO-41", keys)

    async def test_mail_list_excludes_body_columns_and_clamps_page(self):
        from sqlalchemy import event

        await self.incoming()
        statements = []

        def capture(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(self.connection.sync_connection, "before_cursor_execute", capture)
        try:
            response = await self.client.get(
                f"/api/v1/workbench/mail/folders/{self.folder.id}/messages",
                params={"page": 99},
            )
        finally:
            event.remove(
                self.connection.sync_connection, "before_cursor_execute", capture
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["page"], 1)
        self.assertEqual(len(response.json()["items"]), 1)
        self.assertTrue(
            all(
                "workbench_emails.raw" not in sql
                and "workbench_emails.body_html" not in sql
                for sql in statements
            )
        )

    async def test_background_launch_coalesces_requests(self):
        import asyncio
        from unittest.mock import AsyncMock

        from app.routers import workbench_mail as router

        gate = asyncio.Event()

        async def background(*args):
            await gate.wait()

        with patch.object(
            router, "sync_background", AsyncMock(side_effect=background)
        ) as callback:
            router.launch(self.box.id, self.user.id)
            router.launch(self.box.id, self.user.id)
            task = router.tasks[self.user.id]
            try:
                await asyncio.sleep(0)
                callback.assert_awaited_once()
            finally:
                gate.set()
                await task
                await asyncio.sleep(0)
        self.assertNotIn(self.user.id, router.tasks)

    async def test_collection_user_lock_skips_concurrent_pipeline(self):
        # Session advisory locks are connection scoped, independent of fixtures.
        from unittest.mock import AsyncMock

        from sqlalchemy import text

        from app.database import engine

        key = "workbench-collection:" + str(self.user.id)
        async with engine.connect() as connection:
            await connection.execute(
                text("SELECT pg_advisory_lock(hashtextextended(:key,0))"), {"key": key}
            )
            await connection.commit()
            try:
                with patch.object(sources, "collect_user", AsyncMock()) as collect:
                    self.assertFalse(await sources.run_collection(self.user.id))
                    collect.assert_not_awaited()
            finally:
                await connection.execute(
                    text("SELECT pg_advisory_unlock(hashtextextended(:key,0))"),
                    {"key": key},
                )
                await connection.commit()

    async def test_ignore_updates_remain_ignored_until_restore_or_expiry(self):
        await self.incoming(age=25)
        message = await self.collect()
        await self.client.post(f"/api/v1/workbench/messages/{message.id}/dismiss")
        await self.incoming(age=2)
        await self.collect()
        self.assertTrue(message.dismissed)
        self.assertFalse(message.is_read)
        result = (
            await self.client.get("/api/v1/workbench", params={"state": "ignored"})
        ).json()
        self.assertEqual(len(result["messages"]), 1)
        self.assertEqual(
            (
                await self.client.post(
                    f"/api/v1/workbench/messages/{message.id}/restore"
                )
            ).status_code,
            200,
        )
        self.assertFalse(message.dismissed)
        self.assertFalse(message.submitted)

    async def test_expired_mail_never_collects_and_read_requires_ownership(self):
        mail = await self.incoming(age=31)
        self.assertIsNone(await self.collect())
        self.assertEqual(
            (
                await self.client.post(
                    f"/api/v1/workbench/mail/messages/{mail.id}/read"
                )
            ).status_code,
            404,
        )
        fresh = await self.incoming()
        self.user = self.users[1]
        self.assertEqual(
            (
                await self.client.post(
                    f"/api/v1/workbench/mail/messages/{fresh.id}/read"
                )
            ).status_code,
            404,
        )
        self.assertEqual(
            (
                await self.client.get(
                    f"/api/v1/workbench/mail/folders/{self.folder.id}/messages"
                )
            ).status_code,
            404,
        )

    async def test_read_mail_syncs_remote_only_on_explicit_open(self):
        mail = await self.incoming()
        with patch.object(protocol, "mark_read") as remote:
            self.assertEqual(
                (
                    await self.client.get(
                        f"/api/v1/workbench/mail/folders/{self.folder.id}/messages"
                    )
                ).status_code,
                200,
            )
            remote.assert_not_called()
            result = await self.client.post(
                f"/api/v1/workbench/mail/messages/{mail.id}/read"
            )
            self.assertEqual(result.status_code, 200, result.text)
            remote.assert_called_once()
            self.assertNotIn("raw", result.json())
            self.assertTrue(result.json()["is_read"])

    async def test_total_unread_deduplicates_folder_copies_and_updates_on_read(self):
        from app.models.workbench_mail import WBMailFolder

        mail = await self.incoming()
        other = WBMailFolder(mailbox_id=self.box.id, path="Copy")
        self.db.add(other)
        await self.db.flush()
        self.db.add(
            WBMailLocation(
                mail_id=mail.id,
                folder_id=other.id,
                validity="1",
                uid="1",
                is_read=False,
            )
        )
        await self.db.commit()
        overview = (await self.client.get("/api/v1/workbench/mail")).json()
        self.assertEqual(overview["unread_total"], 1)
        self.assertEqual(sum(overview["unread"].values()), 2)
        with patch.object(protocol, "mark_read"):
            self.assertEqual(
                (
                    await self.client.post(
                        f"/api/v1/workbench/mail/messages/{mail.id}/read"
                    )
                ).status_code,
                200,
            )
        self.assertEqual(
            (await self.client.get("/api/v1/workbench/mail")).json()["unread_total"], 0
        )

    async def test_smtp_request_id_prevents_duplicate_delivery(self):
        body = {
            "id": str(uuid4()),
            "to": ["test@example.com"],
            "subject": "Unit test",
            "html": "<p>Test</p>",
            "text": "Test",
        }
        with patch.object(
            protocol,
            "send",
            return_value={"message_id": "<test>", "warning": "", "refused": []},
        ) as send:
            for _ in range(2):
                result = await self.client.post(
                    f"/api/v1/workbench/mail/{self.box.id}/send", json=body
                )
                self.assertEqual(result.status_code, 200, result.text)
            send.assert_called_once()

    async def test_sync_preserves_identity_retention_and_remote_read_flags(self):
        mail = await self.incoming(age=10)
        original = mail.expires_at
        payload = {field: getattr(mail, field) for field in mail_service.MAIL_FIELDS}
        snapshot = [
            {
                **payload,
                "folder": self.folder.path,
                "validity": "2",
                "uid": "9",
                "received_at": now(),
                "is_read": True,
                "rule_id": None,
            }
        ]
        descriptions = [
            {
                "path": self.folder.path,
                "delimiter": "/",
                "flags": [],
                "selectable": True,
            }
        ]
        with patch.object(protocol, "sync", return_value=(descriptions, snapshot)):
            await mail_service.sync(self.db, self.box)
            await self.db.commit()
        self.assertEqual(mail.expires_at, original)
        self.assertTrue(mail.is_read)
        self.assertEqual(
            await self.db.scalar(
                select(func.count())
                .select_from(WBMail)
                .where(WBMail.mailbox_id == self.box.id)
            ),
            1,
        )
        location = await self.db.scalar(
            select(WBMailLocation).where(WBMailLocation.mail_id == mail.id)
        )
        self.assertEqual(location.validity, "2")
        self.assertEqual(location.uid, "9")
        snapshot[0]["is_read"] = False
        with patch.object(protocol, "sync", return_value=(descriptions, snapshot)):
            await mail_service.sync(self.db, self.box)
            await self.db.commit()
        self.assertFalse(mail.is_read)

    async def test_sync_failure_retains_cache_and_expired_ignore_is_forgotten(self):
        mail = await self.incoming(age=5)
        message = await self.collect()
        message.dismissed = True
        with patch.object(
            protocol, "sync", side_effect=OSError("connection unavailable")
        ):
            with self.assertRaises(Exception):
                await mail_service.sync(self.db, self.box)
        self.assertIsNotNone(await self.db.get(WBMail, mail.id))
        message.expires_at = now() - timedelta(seconds=1)
        mail.expires_at = message.expires_at
        await self.db.commit()
        from app.services.workbench_service import cleanup

        await cleanup(self.db)
        await self.db.commit()
        self.assertEqual(
            await self.db.scalar(
                select(func.count())
                .select_from(WBMessage)
                .where(WBMessage.id == message.id)
            ),
            0,
        )
        self.assertEqual(
            await self.db.scalar(
                select(func.count())
                .select_from(WBMessageMail)
                .where(WBMessageMail.message_id == message.id)
            ),
            0,
        )

    async def test_unknown_smtp_result_cannot_be_automatically_retried(self):
        body = {
            "id": str(uuid4()),
            "to": ["test@example.com"],
            "subject": "Unit test",
            "html": "<p>Test</p>",
            "text": "Test",
        }
        with patch.object(protocol, "send", side_effect=TimeoutError()) as send:
            first = await self.client.post(
                f"/api/v1/workbench/mail/{self.box.id}/send", json=body
            )
            second = await self.client.post(
                f"/api/v1/workbench/mail/{self.box.id}/send", json=body
            )
            self.assertEqual(first.status_code, 502)
            self.assertEqual(second.status_code, 409)
            send.assert_called_once()

    async def test_manual_mail_sync_continues_after_first_platform_fails(self):
        from unittest.mock import AsyncMock

        account_id, user_id = self.account.id, self.user.id
        other = WBAccount(
            user_id=user_id,
            name="Next account",
            platform="jira",
            base_url=self.account.base_url,
            username="test",
            password_encrypted=self.account.password_encrypted,
            project_id=self.project.id,
            mail_folder_id=self.folder.id,
            position=1,
        )
        self.db.add(other)
        await self.db.commit()
        other_id = other.id
        collector = AsyncMock(side_effect=[ValueError("test failure"), None])
        with (
            patch.object(mail_service, "sync", AsyncMock()),
            patch.object(sources, "collect", collector),
            patch.object(sources.asyncio, "sleep", AsyncMock()) as pause,
        ):
            await sources.collect_user(self.db, user_id)
        self.assertEqual([call.args for call in pause.await_args_list], [(5,), (5,)])
        self.assertEqual(collector.await_count, 2)
        self.assertEqual((await self.db.get(WBAccount, account_id)).status, "failed")
        self.assertEqual((await self.db.get(WBAccount, other_id)).status, "idle")

    async def test_user_cycle_syncs_all_mailboxes_before_hosting_in_saved_order(self):
        from unittest.mock import AsyncMock

        from app.services.workbench_collection import collect_user

        user_id, account_id = self.user.id, self.account.id
        box_id = self.box.id
        second_box = WBMailbox(
            user_id=user_id,
            address="second@example.com",
            username="test",
            password_encrypted="test-only",
            imap_host="imap.example.com",
            smtp_host="smtp.example.com",
        )
        second_account = WBAccount(
            user_id=user_id,
            name="First by position",
            platform="jira",
            base_url=self.account.base_url,
            username="test",
            password_encrypted="test-only",
            position=-1,
            project_id=self.project.id,
            mail_folder_id=self.folder.id,
        )
        self.db.add_all([second_box, second_account])
        await self.db.commit()
        second_box_id, second_id = second_box.id, second_account.id
        events = []

        async def sync(db, box):
            events.append(("mail", box.id))

        async def collect(db, account):
            events.append(("account", account.id))

        with (
            patch.object(mail_service, "sync", AsyncMock(side_effect=sync)),
            patch.object(sources, "collect", AsyncMock(side_effect=collect)),
            patch.object(sources.asyncio, "sleep", AsyncMock()) as pause,
        ):
            await collect_user(self.db, user_id)
        self.assertEqual(
            [call.args for call in pause.await_args_list], [(5,), (5,), (5,)]
        )
        self.assertEqual(set(events[:2]), {("mail", box_id), ("mail", second_box_id)})
        self.assertEqual(events[2:], [("account", second_id), ("account", account_id)])
