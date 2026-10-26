import asyncio
import email
import logging
from email import policy
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.i18n import message as system_message
from app.middleware.rbac import AnyUser
from app.models.workbench import now
from app.models.workbench_mail import (
    WBMail,
    WBMailbox,
    WBMailDelivery,
    WBMailFolder,
    WBMailLocation,
    WBMailRule,
)
from app.schemas.workbench_mail import Folder, Mailbox, Rule, Send
from app.security import encrypt_credential
from app.services import workbench_mail_protocol as transport
from app.services import workbench_mail_service as service

router = APIRouter()
tasks = {}


async def sync_background(ident, user_id):
    from app.services.workbench_collection import run_collection

    async with AsyncSessionLocal() as db:
        await service.owned_box(db, ident, user_id)
    await run_collection(user_id)


def launch(ident, user_id):
    # A burst of refresh clicks creates one local task per user. The database
    # lock additionally serializes API processes and the scheduled worker.
    current = tasks.get(user_id)
    if current and not current.done():
        return
    task = asyncio.create_task(sync_background(ident, user_id))
    tasks[user_id] = task

    def done(completed):
        if tasks.get(user_id) is completed:
            tasks.pop(user_id, None)
        if not completed.cancelled() and completed.exception():
            logging.getLogger(__name__).warning(
                "工作台收取任务失败：%s", type(completed.exception()).__name__
            )

    task.add_done_callback(done)


@router.get("")
async def overview(user: AnyUser, db: AsyncSession = Depends(get_db)):
    boxes = (
        await db.scalars(
            select(WBMailbox)
            .where(WBMailbox.user_id == user.id)
            .order_by(WBMailbox.address)
        )
    ).all()
    ids = [box.id for box in boxes]
    folders = (
        await db.scalars(
            select(WBMailFolder)
            .where(WBMailFolder.mailbox_id.in_(ids), WBMailFolder.present)
            .order_by(WBMailFolder.path)
        )
    ).all()
    rules = (
        await db.scalars(
            select(WBMailRule)
            .where(WBMailRule.mailbox_id.in_(ids))
            .order_by(WBMailRule.position, WBMailRule.id)
        )
    ).all()
    counts = (
        await db.execute(
            select(WBMailLocation.folder_id, func.count())
            .join(WBMail, WBMail.id == WBMailLocation.mail_id)
            .where(
                WBMail.mailbox_id.in_(ids),
                WBMail.expires_at > now(),
                ~WBMailLocation.is_read,
            )
            .group_by(WBMailLocation.folder_id)
        )
    ).all()
    unread_total = await db.scalar(
        select(func.count())
        .select_from(WBMail)
        .where(WBMail.mailbox_id.in_(ids), WBMail.expires_at > now(), ~WBMail.is_read)
    )
    return {
        "mailboxes": [service.public(box) for box in boxes],
        "folders": [service.public(folder) for folder in folders],
        "rules": [service.public(rule) for rule in rules],
        "unread": {str(ident): count for ident, count in counts},
        "unread_total": unread_total,
    }


@router.post("", status_code=201)
async def add(body: Mailbox, user: AnyUser, db: AsyncSession = Depends(get_db)):
    if not body.password or not body.password.get_secret_value():
        raise HTTPException(
            422, system_message("errors.enterAMailboxPasswordOrAppPassword")
        )
    box = WBMailbox(
        user_id=user.id,
        **body.model_dump(exclude={"password"}),
        password_encrypted=encrypt_credential(body.password.get_secret_value(), "mail"),
        status="syncing",
    )
    service.config(box)
    db.add(box)
    await db.commit()
    launch(box.id, user.id)
    return service.public(box)


@router.put("/{ident}")
async def edit(
    ident: UUID, body: Mailbox, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    box = await service.owned_box(db, ident, user.id)
    for key, value in body.model_dump(exclude={"password"}).items():
        setattr(box, key, value)
    if body.password and body.password.get_secret_value():
        box.password_encrypted = encrypt_credential(
            body.password.get_secret_value(), "mail"
        )
    service.config(box)
    box.status, box.error = "syncing", None
    await db.commit()
    launch(box.id, user.id)
    return service.public(box)


@router.post("/{ident}/sync", status_code=202)
async def sync(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    box = await service.owned_box(db, ident, user.id)
    # A previous worker may have exited; an advisory lock arbitrates overlapping requests.
    box.status, box.error = "syncing", None
    await db.commit()
    launch(box.id, user.id)
    return {"ok": True}


@router.post("/{ident}/folders", status_code=201)
async def create_folder(
    ident: UUID, body: Folder, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    box = await service.owned_box(db, ident, user.id)
    try:
        await asyncio.to_thread(transport.create_folder, service.config(box), body.name)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            502,
            system_message(
                "errors.failedToCreateFolderCheckItsNameAndMailboxPermissions"
            ),
        ) from None
    box.status = "syncing"
    await db.commit()
    launch(box.id, user.id)
    return {"ok": True}


@router.post("/{ident}/rules", status_code=201)
async def add_rule(
    ident: UUID, body: Rule, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    box = await service.owned_box(db, ident, user.id)
    await db.scalar(
        select(WBMailbox.id).where(WBMailbox.id == box.id).with_for_update()
    )
    folder = await service.owned_folder(db, body.folder_id, user.id)
    if folder.mailbox_id != box.id:
        raise HTTPException(
            422, system_message("errors.theTargetFolderMustBelongToTheCurrentMailbox")
        )
    last = await db.scalar(
        select(func.max(WBMailRule.position)).where(WBMailRule.mailbox_id == ident)
    )
    row = WBMailRule(
        mailbox_id=ident,
        position=(last if last is not None else -1) + 1,
        **body.model_dump(),
    )
    db.add(row)
    await db.commit()
    return service.public(row)


@router.put("/{ident}/rules/{rule_id}")
async def edit_rule(
    ident: UUID,
    rule_id: UUID,
    body: Rule,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    await service.owned_box(db, ident, user.id)
    row = await db.get(WBMailRule, rule_id)
    folder = await service.owned_folder(db, body.folder_id, user.id)
    if not row or row.mailbox_id != ident:
        raise HTTPException(404, system_message("errors.ruleNotFound"))
    if folder.mailbox_id != ident:
        raise HTTPException(
            422,
            system_message("errors.theTargetFolderDoesNotBelongToTheCurrentMailbox"),
        )
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    await db.commit()
    return service.public(row)


@router.delete("/{ident}/rules/{rule_id}")
async def remove_rule(
    ident: UUID, rule_id: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    await service.owned_box(db, ident, user.id)
    await db.execute(
        delete(WBMailRule).where(
            WBMailRule.id == rule_id, WBMailRule.mailbox_id == ident
        )
    )
    await db.commit()
    return {"ok": True}


@router.get("/folders/{ident}/messages")
async def messages(
    ident: UUID,
    user: AnyUser,
    page: int = Query(1, ge=1),
    q: str = Query("", max_length=200),
    db: AsyncSession = Depends(get_db),
):
    await service.owned_folder(db, ident, user.id)
    columns = [
        column
        for column in WBMail.__table__.columns
        if column.name not in ("raw", "body_text", "body_html")
    ]
    base = select(*columns).where(
        WBMail.id.in_(
            select(WBMailLocation.mail_id).where(WBMailLocation.folder_id == ident)
        ),
        WBMail.expires_at > now(),
    )
    if q:
        base = base.where(
            WBMail.subject.ilike("%" + q.replace("%", "\\%").replace("_", "\\_") + "%")
        )
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    page = min(page, max(1, (total + 29) // 30))
    rows = (
        (
            await db.execute(
                base.order_by(WBMail.received_at.desc(), WBMail.id)
                .offset((page - 1) * 30)
                .limit(30)
            )
        )
        .mappings()
        .all()
    )
    return {"items": [dict(row) for row in rows], "total": total, "page": page}


@router.post("/messages/{ident}/read")
async def read(ident: UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    mail = await service.owned_mail(db, ident, user.id)
    box = await service.owned_box(db, mail.mailbox_id, user.id)
    await service.read(db, mail, box)
    await db.commit()
    return service.detail(mail)


@router.get("/messages/{ident}/attachments/{index}")
async def attachment(
    ident: UUID, index: int, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    mail = await service.owned_mail(db, ident, user.id)
    parts = list(email.message_from_bytes(mail.raw, policy=policy.default).walk())
    if (
        index < 0
        or index >= len(parts)
        or parts[index].get_content_disposition() != "attachment"
    ):
        raise HTTPException(404, system_message("errors.attachmentNotFound"))
    return Response(
        parts[index].get_payload(decode=True),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''"
            + quote(parts[index].get_filename() or "attachment")
        },
    )


@router.post("/{ident}/send")
async def send(
    ident: UUID, body: Send, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    box = await service.owned_box(db, ident, user.id)
    settings = service.config(box)
    # Do not automatically resend when an SMTP timeout leaves delivery uncertain.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": "send:" + str(body.id)},
    )
    previous = await db.get(WBMailDelivery, body.id)
    if previous:
        if previous.mailbox_id != box.id:
            raise HTTPException(409, system_message("errors.requestIdentifierConflict"))
        if previous.status == "sent":
            return previous.result
        raise HTTPException(
            409,
            system_message(
                "errors.deliveryStatusIsUncertainCheckYourMailboxBeforeSendingAgainToAvoid"
            ),
        )
    delivery = WBMailDelivery(
        id=body.id,
        mailbox_id=box.id,
        status="sending",
        expires_at=now() + service.RETENTION,
    )
    db.add(delivery)
    await db.commit()
    folders = (
        await db.scalars(
            select(WBMailFolder).where(
                WBMailFolder.mailbox_id == box.id, WBMailFolder.present
            )
        )
    ).all()
    sent = next((folder.path for folder in folders if "\\Sent" in folder.flags), None)
    sent = sent or next(
        (
            folder.path
            for folder in folders
            if folder.path.lower() in ("sent", "sent items", "sent messages", "已发送")
        ),
        None,
    )
    try:
        result = await asyncio.to_thread(
            transport.send, settings, body.model_dump(mode="json", exclude={"id"}), sent
        )
    except Exception:
        delivery.status, delivery.result = (
            "unknown",
            {"warning": system_message("errors.deliveryUncertain")},
        )
        await db.commit()
        raise HTTPException(502, delivery.result["warning"]) from None
    delivery.status, delivery.result = "sent", result
    await db.commit()
    return result
