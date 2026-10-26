"""Collect only issues referenced by recent mail in the configured folder."""

import asyncio
import re
from datetime import datetime, timezone
from urllib.parse import quote, unquote, urlsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.database import engine
from app.i18n import message as system_message
from app.models.workbench import WBAccount, WBJob, WBMessage, now
from app.models.workbench_mail import WBMail, WBMailbox, WBMailLocation, WBMessageMail
from app.services.jira_client import JiraClient, platform_password
from app.services.workbench_limits import COLLECTION_PAUSE_SECONDS, RETENTION
from app.services.workbench_mail_service import owned_folder
from app.services.workbench_resources import resource_payload, validate_source_url
from app.services.workbench_schedule import working


def issue_key(account, mail):
    root = urlsplit(account.base_url)
    path = root.path.rstrip("/") + (
        "/browse/" if account.platform == "jira" else "/issue/"
    )
    found = []
    for value in re.findall(
        r'https?://[^\s<>"\']+', mail.body_text + " " + mail.body_html
    ):
        try:
            parts = urlsplit(value.replace("&amp;", "&").rstrip(").,;]"))
        except ValueError:
            continue
        if (
            parts.scheme != root.scheme
            or parts.netloc.lower() != root.netloc.lower()
            or not parts.path.startswith(path)
        ):
            continue
        key = unquote(parts.path[len(path) :]).split("/")[0]
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*-\d+", key) and key not in found:
            found.append(key)
    # A notification may link related issues too. Prefer the issue named in its subject.
    subject = re.findall(r"\b[A-Za-z][A-Za-z0-9_]*-\d+\b", mail.subject)
    return (
        next((key for key in subject if key in found), None)
        if subject
        else (found[0] if len(found) == 1 else None)
    )


async def payload(account, key):
    if account.platform == "jira":
        async with JiraClient(account) as client:
            issue = await client.get(
                "issue/" + quote(key, safe=""),
                {"fields": "summary,description,status,updated"},
            )
            comments = await client.comments(key)
        fields = issue["fields"]
        body = (
            (fields.get("description") or "")
            + "\n\n"
            + "\n\n".join(
                f"{c.get('author', '')} · {c.get('created', '')}\n{c.get('body', '')}"
                for c in comments
            )
        )
        return {
            **resource_payload(
                key,
                fields.get("summary", key),
                body,
                account.base_url + "/browse/" + quote(key, safe=""),
            ),
            "updated_at": fields.get("updated"),
        }
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        response = await client.get(
            account.base_url + "/api/issues/" + quote(key, safe=""),
            headers={"Authorization": "Bearer " + platform_password(account)},
            params={
                "fields": "idReadable,summary,description,updated,comments(text,created,author(fullName))"
            },
        )
        response.raise_for_status()
        issue = response.json()
    body = (
        (issue.get("description") or "")
        + "\n\n"
        + "\n\n".join(
            f"{c.get('author', {}).get('fullName', '')}\n{c.get('text', '')}"
            for c in issue.get("comments", [])
        )
    )
    return {
        **resource_payload(
            key,
            issue.get("summary", key),
            body,
            account.base_url + "/issue/" + quote(key, safe=""),
        ),
        "updated_at": issue.get("updated"),
    }


def resource_time(value, fallback):
    """Use source timestamps, never the local fetch clock, to compare freshness."""
    try:
        parsed = (
            datetime.fromtimestamp(value / 1000, timezone.utc)
            if isinstance(value, (int, float))
            else datetime.fromisoformat(value)
        )
        return max(parsed, fallback) if parsed.tzinfo else fallback
    except (TypeError, ValueError, OverflowError, OSError):
        return fallback


def apply_update(message, active):
    message.is_read = False
    if message.dismissed:
        return
    if active:
        message.is_read = True
    else:
        message.submitted = False


async def collect(db, account):
    if account.deleted_at:
        return
    if not account.mail_folder_id or not account.project_id:
        raise HTTPException(
            422, system_message("errors.firstLinkAMailFolderToAPlatformInThisProject")
        )
    validate_source_url(account.base_url)
    await owned_folder(db, account.mail_folder_id, account.user_id)
    mails = (
        await db.scalars(
            select(WBMail)
            .options(defer(WBMail.raw))
            .where(
                WBMail.id.in_(
                    select(WBMailLocation.mail_id).where(
                        WBMailLocation.folder_id == account.mail_folder_id
                    )
                ),
                WBMail.expires_at > now(),
            )
            .order_by(WBMail.received_at)
        )
    ).all()
    groups = {}
    for mail in mails:
        key = issue_key(account, mail)
        if key:
            groups.setdefault(key, []).append(mail)
    errors = []
    # Commit independently: one failed resource must not undo earlier successes.
    for key, mails in sorted(
        groups.items(),
        key=lambda group: (max(mail.received_at for mail in group[1]), group[0]),
    ):
        try:
            async with db.begin_nested():
                await refresh_resource(db, account, key, mails)
            await db.commit()
        except Exception as exc:
            if not db.is_active:
                raise
            reason = (
                str(exc.detail)[:300]
                if isinstance(exc, HTTPException)
                else f"网站返回 HTTP {exc.response.status_code}"
                if isinstance(exc, httpx.HTTPStatusError)
                else "网络请求超时"
                if isinstance(exc, (httpx.TimeoutException, TimeoutError))
                else "网站响应异常，请检查授权、链接和网络"
            )
            errors.append(f"{key}：{reason}")
    if errors:
        raise HTTPException(
            502,
            system_message("errors.collectionFailed"),
        )


async def refresh_resource(db, account, key, mails):
    # Account advisory lock serializes manual and scheduled collection.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": "account:" + str(account.id)},
    )
    message = await db.scalar(
        select(WBMessage)
        .where(WBMessage.account_id == account.id, WBMessage.source_key == key)
        .with_for_update()
    )
    if not message:
        message = await db.scalar(
            select(WBMessage)
            .where(
                WBMessage.account_id == account.id,
                WBMessage.source_key.is_(None),
                WBMessage.payload["key"].astext == key,
                WBMessage.expires_at > now(),
            )
            .order_by(WBMessage.received_at.desc())
            .limit(1)
            .with_for_update()
        )
        if message:
            message.source_key = key
            # Old direct crawls used collection time; mail becomes the clock once linked.
            message.received_at = max(mail.received_at for mail in mails)
    linked = (
        set(
            (
                await db.scalars(
                    select(WBMessageMail.mail_id).where(
                        WBMessageMail.message_id == message.id
                    )
                )
            ).all()
        )
        if message
        else set()
    )
    additions = [mail for mail in mails if mail.id not in linked]
    latest = max(mails, key=lambda mail: (mail.received_at, str(mail.id)))
    newer = (
        not message
        or not message.resource_updated_at
        or latest.received_at > message.resource_updated_at
    )
    if not additions and not newer:
        return
    data = await payload(account, key) if newer else None
    if not message:
        message = WBMessage(
            user_id=account.user_id,
            account_id=account.id,
            project_id=account.project_id,
            source_key=key,
            payload=data,
            revision=0,
            received_at=latest.received_at,
            expires_at=latest.expires_at,
        )
        db.add(message)
        await db.flush()
    if newer:
        message.resource_updated_at = resource_time(
            data.pop("updated_at", None), latest.received_at
        )
        message.resource_source = {
            "kind": "email",
            "mail_id": str(latest.id),
            "timestamp": latest.received_at.isoformat(),
        }
        message.payload, message.revision = (
            data,
            message.revision + max(1, len(additions)),
        )
        if not message.project_id:
            message.project_id = account.project_id
        active = await db.scalar(
            select(WBJob.id)
            .where(
                WBJob.message_id == message.id, WBJob.status.in_(["queued", "running"])
            )
            .limit(1)
        )
        apply_update(message, bool(active))
    # Mail receipt alone controls retention, even when its resource is stale.
    message.received_at = max(message.received_at, latest.received_at)
    message.expires_at = message.received_at + RETENTION
    for mail in additions:
        db.add(WBMessageMail(message_id=message.id, mail_id=mail.id))
    await db.execute(
        update(WBJob)
        .where(WBJob.message_id == message.id)
        .values(expires_at=message.expires_at)
    )
    await db.flush()


async def finish(db, job):
    message = await db.scalar(
        select(WBMessage).where(WBMessage.id == job.message_id).with_for_update()
    )
    if message:
        job.expires_at = message.expires_at
        if message.revision > job.input_revision and not message.dismissed:
            message.submitted, message.is_read = False, False


async def collect_user(db, user_id, schedule=None):
    """Finish all mailbox syncs before visiting hosting cards in their saved order."""
    from app.services.workbench_mail_service import sync as sync_mail

    mailbox_ids = list(
        (
            await db.scalars(
                select(WBMailbox.id)
                .where(WBMailbox.user_id == user_id)
                .order_by(WBMailbox.address, WBMailbox.id)
            )
        ).all()
    )
    pause_needed = False
    for mailbox_id in mailbox_ids:
        if pause_needed:
            await asyncio.sleep(COLLECTION_PAUSE_SECONDS)
        if schedule and not working(schedule, now()):
            return
        try:
            box = await db.get(WBMailbox, mailbox_id)
            if not box:
                continue
            pause_needed = True
            box.status, box.error = "syncing", None
            await db.commit()
            await sync_mail(db, box)
            await db.commit()
        except Exception as exc:
            await db.rollback()
            if isinstance(exc, HTTPException) and exc.status_code == 409:
                continue
            box = await db.get(WBMailbox, mailbox_id)
            if box:
                box.status, box.error = (
                    "failed",
                    str(exc.detail)[:1000]
                    if isinstance(exc, HTTPException)
                    else system_message("errors.checkFailed"),
                )
                await db.commit()
    accounts = list(
        (
            await db.scalars(
                select(WBAccount.id)
                .where(
                    WBAccount.user_id == user_id,
                    WBAccount.enabled,
                    WBAccount.deleted_at.is_(None),
                )
                .order_by(WBAccount.position, WBAccount.id)
            )
        ).all()
    )
    for account_id in accounts:
        if pause_needed:
            await db.commit()
            await asyncio.sleep(COLLECTION_PAUSE_SECONDS)
        # Check each platform's start time, while already-started requests finish.
        if schedule and not working(schedule, now()):
            return
        account = await db.get(WBAccount, account_id)
        if not account or not account.enabled or account.deleted_at:
            continue
        pause_needed = True
        account.status, account.error = "collecting", None
        await db.commit()
        try:
            async with asyncio.timeout(600):
                await collect(db, account)
            account.status, account.error, account.last_run_at = "idle", None, now()
            await db.commit()
        except Exception as exc:
            await db.rollback()
            account = await db.get(WBAccount, account_id)
            if account:
                account.status = "failed"
                account.error = (
                    str(exc.detail)[:1000]
                    if isinstance(exc, HTTPException)
                    else system_message("errors.collectionFailed")
                )
                account.last_run_at = now()
                await db.commit()


async def run_collection(user_id, schedule=None):
    """A dedicated connection keeps the user lock across per-resource commits."""
    lock_key = "workbench-collection:" + str(user_id)
    async with engine.connect() as connection:
        locked = await connection.scalar(
            text("SELECT pg_try_advisory_lock(hashtextextended(:key,0))"),
            {"key": lock_key},
        )
        await connection.commit()
        if not locked:
            return False
        try:
            async with AsyncSession(bind=connection, expire_on_commit=False) as db:
                await db.execute(
                    update(WBAccount)
                    .where(
                        WBAccount.user_id == user_id, WBAccount.status == "collecting"
                    )
                    .values(status="idle")
                )
                await db.commit()
                await collect_user(db, user_id, schedule)
            return True
        finally:
            await connection.rollback()
            await connection.execute(
                text("SELECT pg_advisory_unlock(hashtextextended(:key,0))"),
                {"key": lock_key},
            )
            await connection.commit()
