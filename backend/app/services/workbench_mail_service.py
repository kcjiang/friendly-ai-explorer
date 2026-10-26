"""User-owned mailbox cache. Remote read flags change only on explicit reading."""

import asyncio
import base64
import email
import imaplib
import logging
import ssl
from email import policy
from html import escape

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.i18n import message as system_message
from app.models.workbench import now
from app.models.workbench_mail import (
    WBMail,
    WBMailbox,
    WBMailFolder,
    WBMailLocation,
    WBMailRule,
)
from app.security import decrypt_credential
from app.services import workbench_mail_protocol as transport
from app.services.workbench_limits import RETENTION
from app.services.workbench_mail_html import SafeHTML

MAIL_FIELDS = (
    "source_key",
    "message_id",
    "subject",
    "sender",
    "recipients",
    "cc",
    "body_text",
    "body_html",
    "raw",
)
logger = logging.getLogger(__name__)


def public(row):
    return {
        column.name: getattr(row, column.name)
        for column in row.__table__.columns
        if column.name not in ("user_id", "password_encrypted", "raw")
    }


def config(box):
    result = public(box)
    for protocol in ("imap", "smtp"):
        if result[protocol + "_security"] not in ("ssl", "starttls"):
            raise HTTPException(
                422, system_message("errors.mailboxConnectionsRequireSslTlsOrStarttls")
            )
    try:
        result["password"] = decrypt_credential(box.password_encrypted, "mail")
    except InvalidToken:
        raise HTTPException(
            422,
            system_message(
                "errors.cannotDecryptMailboxCredentialsSaveThePasswordAgain"
            ),
        ) from None
    return result


async def owned_box(db, ident, user_id):
    box = await db.scalar(
        select(WBMailbox).where(WBMailbox.id == ident, WBMailbox.user_id == user_id)
    )
    if not box:
        raise HTTPException(404, system_message("errors.mailboxNotFound"))
    return box


async def owned_folder(db, ident, user_id):
    folder = await db.scalar(
        select(WBMailFolder)
        .join(WBMailbox)
        .where(
            WBMailFolder.id == ident,
            WBMailbox.user_id == user_id,
            WBMailFolder.present,
            WBMailFolder.selectable,
        )
    )
    if not folder:
        raise HTTPException(
            404, system_message("errors.folderNotFoundOrUnavailableForReading")
        )
    return folder


async def owned_mail(db, ident, user_id):
    mail = await db.scalar(
        select(WBMail)
        .join(WBMailbox)
        .where(
            WBMail.id == ident, WBMailbox.user_id == user_id, WBMail.expires_at > now()
        )
    )
    if not mail:
        raise HTTPException(
            404, system_message("errors.emailNotFoundOrOlderThan30Days")
        )
    return mail


async def sync(db, box):
    # Transaction lock protects remote moves and the complete snapshot replacement.
    locked = await db.scalar(
        text("SELECT pg_try_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": "mail:" + str(box.id)},
    )
    if not locked:
        raise HTTPException(
            409, system_message("errors.mailboxIsSynchronizingRefreshLater")
        )
    settings = config(box)
    cached = list(
        (await db.scalars(select(WBMail).where(WBMail.mailbox_id == box.id))).all()
    )
    mails = {mail.source_key: mail for mail in cached}
    by_id = {mail.id: mail for mail in cached}
    known = {}
    for location, folder in (
        await db.execute(
            select(WBMailLocation, WBMailFolder)
            .join(WBMailFolder, WBMailFolder.id == WBMailLocation.folder_id)
            .where(WBMailFolder.mailbox_id == box.id)
        )
    ).all():
        mail = by_id.get(location.mail_id)
        if mail:
            known[(folder.path, location.validity, location.uid)] = {
                field: getattr(mail, field) for field in MAIL_FIELDS
            }
    rules = [
        {**public(rule), "destination": folder.path}
        for rule, folder in (
            await db.execute(
                select(WBMailRule, WBMailFolder)
                .join(WBMailFolder, WBMailFolder.id == WBMailRule.folder_id)
                .where(
                    WBMailRule.mailbox_id == box.id,
                    WBMailRule.enabled,
                    WBMailFolder.present,
                )
                .order_by(WBMailRule.position, WBMailRule.id)
            )
        ).all()
    ]
    try:
        descriptions, rows = await asyncio.to_thread(
            transport.sync, settings, known, rules, now() - RETENTION
        )
    except transport.MailProtocolError as exc:
        raise HTTPException(502, str(exc)) from None
    except imaplib.IMAP4.error:
        raise HTTPException(
            502,
            system_message(
                "errors.imapConnectionRejectedCheckCredentialsImapPermissionsAndServerConfiguration"
            ),
        ) from None
    except ssl.SSLError:
        raise HTTPException(
            502,
            system_message(
                "errors.mailboxTlsConnectionOrCertificateValidationFailedCheckTheHostAndEncryption"
            ),
        ) from None
    except TimeoutError:
        raise HTTPException(
            502, system_message("errors.mailboxSynchronizationTimedOutTryAgainLater")
        ) from None
    except OSError:
        raise HTTPException(
            502,
            system_message(
                "errors.cannotConnectToTheMailboxServerCheckTheNetworkAndHost"
            ),
        ) from None
    except Exception as exc:
        # Do not log remote mail content or credential-bearing exception messages.
        logger.error("邮箱同步适配器异常：%s", type(exc).__name__)
        raise HTTPException(
            502,
            system_message(
                "errors.mailboxSynchronizationFailedCheckCredentialsCertificatesAndNetworkExistingCachedMailIs"
            ),
        ) from None
    folders = {
        folder.path: folder
        for folder in (
            await db.scalars(
                select(WBMailFolder).where(WBMailFolder.mailbox_id == box.id)
            )
        ).all()
    }
    for folder in folders.values():
        folder.present = False
    for description in descriptions:
        folder = folders.get(description["path"])
        if not folder:
            folder = WBMailFolder(mailbox_id=box.id, **description)
            db.add(folder)
            folders[description["path"]] = folder
        else:
            for field, value in description.items():
                setattr(folder, field, value)
        folder.present = True
    await db.flush()
    await db.execute(
        delete(WBMailLocation).where(
            WBMailLocation.folder_id.in_(
                select(WBMailFolder.id).where(WBMailFolder.mailbox_id == box.id)
            )
        )
    )
    grouped = {}
    for row in rows:
        grouped.setdefault(row["source_key"], []).append(row)
    retained = set()
    for key, copies in grouped.items():
        row = min(copies, key=lambda value: value["received_at"])
        mail = mails.get(key)
        if not mail:
            mail = WBMail(
                mailbox_id=box.id,
                **{field: row[field] for field in MAIL_FIELDS},
                received_at=row["received_at"],
                expires_at=row["received_at"] + RETENTION,
            )
            db.add(mail)
            await db.flush()
        # A folder COPY/MOVE can rewrite INTERNALDATE; it must never renew retention.
        mail.received_at = min(mail.received_at, row["received_at"])
        mail.expires_at = mail.received_at + RETENTION
        mail.is_read = all(copy["is_read"] for copy in copies)
        mail.rule_id = row.get("rule_id")
        retained.add(mail.id)
        for copy in copies:
            db.add(
                WBMailLocation(
                    mail_id=mail.id,
                    folder_id=folders[copy["folder"]].id,
                    validity=copy["validity"],
                    uid=copy["uid"],
                    is_read=copy["is_read"],
                )
            )
    await db.execute(
        delete(WBMail).where(WBMail.mailbox_id == box.id, WBMail.id.not_in(retained))
    )
    box.status, box.error, box.last_sync_at = "idle", None, now()
    await db.flush()


async def read(db, mail, box):
    locked = await db.scalar(
        text("SELECT pg_try_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": "mail:" + str(box.id)},
    )
    if not locked:
        raise HTTPException(
            409,
            system_message(
                "errors.mailboxIsCollectingMessagesWaitForSynchronizationBeforeOpeningTheMessage"
            ),
        )
    await db.refresh(mail)
    rows = (
        await db.execute(
            select(WBMailLocation, WBMailFolder)
            .join(WBMailFolder)
            .where(WBMailLocation.mail_id == mail.id)
        )
    ).all()
    if not rows:
        raise HTTPException(
            409,
            system_message("errors.theMessageLocationChangedSynchronizeAndTryAgain"),
        )
    try:
        await asyncio.to_thread(
            transport.mark_read,
            config(box),
            [
                {"folder": f.path, "validity": loc.validity, "uid": loc.uid}
                for loc, f in rows
            ],
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            502, system_message("errors.cannotSynchronizeReadStatusTryAgain")
        ) from None
    mail.is_read = True
    for loc, _ in rows:
        loc.is_read = True


def detail(mail):
    result = public(mail)
    parts = list(email.message_from_bytes(mail.raw, policy=policy.default).walk())
    images = {
        part["Content-ID"].strip("<>"): "data:"
        + part.get_content_type()
        + ";base64,"
        + base64.b64encode(part.get_payload(decode=True) or b"").decode()
        for part in parts
        if part.get("Content-ID")
        and part.get_content_type()
        in ("image/png", "image/jpeg", "image/gif", "image/webp")
    }
    parser = SafeHTML(images, preserve_remote=True)
    parser.feed(mail.body_html or "<pre>" + escape(mail.body_text) + "</pre>")
    result["body_html"] = "".join(parser.output)
    result["has_remote_images"] = parser.has_remote_images
    result["attachments"] = [
        {
            "index": i,
            "name": part.get_filename() or "附件",
            "size": len(part.get_payload(decode=True) or b""),
        }
        for i, part in enumerate(parts)
        if part.get_content_disposition() == "attachment"
    ]
    return result
