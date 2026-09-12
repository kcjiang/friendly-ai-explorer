import asyncio
import base64
import hashlib
import imaplib
import email as email_stdlib
from email.header import decode_header as _decode_hdr
from html.parser import HTMLParser
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from cryptography.fernet import Fernet

from app.config import settings
from app.models.email_account import EmailAccount, SyncedEmail, PreTicket
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas.email_schema import EmailAccountSetup, UpdatePreTicketRequest
from app.ai.tasks.email_analyzer import analyze_email
from app.services.ticket_service import _generate_ticket_no


# ── 加密工具 ─────────────────────────────────────────────────

def _fernet() -> Fernet:
    key = hashlib.sha256(settings.jwt_secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))

def encrypt_pw(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()

def decrypt_pw(enc: str) -> str:
    return _fernet().decrypt(enc.encode()).decode()


# ── 邮件解析工具 ──────────────────────────────────────────────

def _decode_str(val: Optional[str]) -> str:
    if not val:
        return ""
    parts = _decode_hdr(val)
    result = []
    for part, enc in parts:
        if isinstance(part, bytes):
            result.append(part.decode(enc or "utf-8", errors="replace"))
        else:
            result.append(str(part))
    return "".join(result)


class _HtmlStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
    def handle_data(self, data: str):
        self._parts.append(data)
    def get_text(self) -> str:
        return "\n".join(self._parts)


def _extract_body(msg) -> str:
    """递归提取邮件纯文本正文"""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in cd:
                payload = part.get_payload(decode=True)
                charset  = part.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace") if payload else ""
        # fallback: try html
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True)
                charset  = part.get_content_charset() or "utf-8"
                html = payload.decode(charset, errors="replace") if payload else ""
                s = _HtmlStripper(); s.feed(html)
                return s.get_text()
    else:
        payload = msg.get_payload(decode=True)
        charset  = msg.get_content_charset() or "utf-8"
        if payload:
            text = payload.decode(charset, errors="replace")
            if msg.get_content_type() == "text/html":
                s = _HtmlStripper(); s.feed(text)
                return s.get_text()
            return text
    return ""


def _parse_date(date_str: str) -> Optional[datetime]:
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(date_str).replace(tzinfo=timezone.utc)
    except Exception:
        return None


# ── IMAP 同步（阻塞，在线程池执行）──────────────────────────

def _fetch_imap_blocking(host, port, username, password, use_ssl, limit) -> list[dict]:
    conn = imaplib.IMAP4_SSL(host, port) if use_ssl else imaplib.IMAP4(host, port)
    conn.login(username, password)
    conn.select("INBOX")

    _, data = conn.search(None, "ALL")
    all_ids = data[0].split()

    if limit > 0:
        ids_to_fetch = all_ids[-limit:]
    else:
        ids_to_fetch = all_ids

    emails = []
    for uid in reversed(ids_to_fetch):  # 最新的先
        _, msg_data = conn.fetch(uid, "(RFC822)")
        raw = msg_data[0][1]
        msg = email_stdlib.message_from_bytes(raw)

        emails.append({
            "message_id": msg.get("Message-ID") or uid.decode(),
            "subject":    _decode_str(msg.get("Subject")),
            "sender":     _decode_str(msg.get("From")),
            "body_text":  _extract_body(msg),
            "received_at":_parse_date(msg.get("Date", "")),
        })

    conn.logout()
    return emails


# ── 账号管理 ─────────────────────────────────────────────────

async def setup_account(body: EmailAccountSetup, db: AsyncSession, user: User) -> EmailAccount:
    # 测试连接
    try:
        await asyncio.to_thread(
            _fetch_imap_blocking,
            body.imap_host, body.imap_port,
            body.username, body.password,
            body.use_ssl, 1,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"IMAP 连接失败：{str(e)}")

    # 删除旧账号（每人一个）
    old = await db.execute(select(EmailAccount).where(EmailAccount.user_id == user.id))
    if acct := old.scalar_one_or_none():
        await db.delete(acct)

    acct = EmailAccount(
        user_id=user.id,
        email_address=body.email_address,
        imap_host=body.imap_host,
        imap_port=body.imap_port,
        username=body.username,
        password_encrypted=encrypt_pw(body.password),
        use_ssl=body.use_ssl,
    )
    db.add(acct)
    await db.commit()
    await db.refresh(acct)
    return acct


async def get_account(db: AsyncSession, user: User) -> Optional[EmailAccount]:
    r = await db.execute(select(EmailAccount).where(EmailAccount.user_id == user.id))
    return r.scalar_one_or_none()


async def delete_account(db: AsyncSession, user: User) -> dict:
    acct = await get_account(db, user)
    if not acct:
        raise HTTPException(status_code=404, detail="账号不存在")
    await db.delete(acct)
    await db.commit()
    return {"message": "账号已删除"}


# ── 同步邮件 ─────────────────────────────────────────────────

async def sync_emails(limit: int, db: AsyncSession, user: User) -> dict:
    acct = await get_account(db, user)
    if not acct:
        raise HTTPException(status_code=404, detail="请先配置 IMAP 账号")

    password = decrypt_pw(acct.password_encrypted)

    # 在线程池拉取邮件
    fetched = await asyncio.to_thread(
        _fetch_imap_blocking,
        acct.imap_host, acct.imap_port,
        acct.username, password,
        acct.use_ssl, limit,
    )

    # 查询已存在的 message_id
    existing = await db.execute(
        select(SyncedEmail.message_id).where(SyncedEmail.account_id == acct.id)
    )
    existing_ids = {r[0] for r in existing.fetchall()}

    new_objs: list[SyncedEmail] = []
    for e in fetched:
        if e["message_id"] in existing_ids:
            continue
        obj = SyncedEmail(
            account_id=acct.id,
            message_id=e["message_id"],
            subject=e["subject"],
            sender=e["sender"],
            body_text=e["body_text"],
            received_at=e["received_at"],
        )
        db.add(obj)
        new_objs.append(obj)

    await db.commit()
    for obj in new_objs:
        await db.refresh(obj)

    # 更新最后同步时间
    acct.last_synced_at = datetime.now(timezone.utc)
    await db.commit()

    # AI 分析新邮件
    analyzed = 0
    pre_created = 0
    for obj in new_objs:
        result = await analyze_email(
            obj.sender or "", obj.subject or "", obj.body_text or ""
        )
        obj.is_analyzed          = True
        obj.ai_is_customer_email = result.get("is_customer_email", False)
        obj.ai_is_defect_report  = result.get("is_defect_report", False)
        obj.ai_summary           = result.get("summary", "")

        # 生成预创建工单
        if obj.ai_is_defect_report and result.get("ticket"):
            t = result["ticket"]
            pt = PreTicket(
                email_id=obj.id,
                creator_id=user.id,
                title=t.get("title", obj.subject or "未知问题"),
                description=t.get("description"),
                customer_name=t.get("customer_name"),
                customer_contact=t.get("customer_contact") or obj.sender,
                product_name=t.get("product_name"),
                firmware_version=t.get("firmware_version"),
                priority=t.get("priority", "medium"),
            )
            db.add(pt)
            pre_created += 1

        analyzed += 1

    await db.commit()
    return {"synced": len(new_objs), "analyzed": analyzed, "pre_tickets_created": pre_created}


# ── 邮件列表 ─────────────────────────────────────────────────

async def list_emails(db: AsyncSession, user: User) -> list[SyncedEmail]:
    acct = await get_account(db, user)
    if not acct:
        return []
    r = await db.execute(
        select(SyncedEmail)
        .where(SyncedEmail.account_id == acct.id)
        .order_by(SyncedEmail.received_at.desc())
    )
    return list(r.scalars().all())


# ── 预创建工单管理 ────────────────────────────────────────────

async def list_pre_tickets(db: AsyncSession, user: User) -> list[dict]:
    r = await db.execute(
        select(PreTicket, SyncedEmail.subject, SyncedEmail.sender)
        .join(SyncedEmail, PreTicket.email_id == SyncedEmail.id)
        .where(PreTicket.creator_id == user.id)
        .order_by(PreTicket.created_at.desc())
    )
    rows = r.fetchall()
    result = []
    for pt, subj, sender in rows:
        d = {
            "id":                str(pt.id),
            "email_id":          str(pt.email_id),
            "title":             pt.title,
            "description":       pt.description,
            "customer_name":     pt.customer_name,
            "customer_contact":  pt.customer_contact,
            "product_name":      pt.product_name,
            "firmware_version":  pt.firmware_version,
            "priority":          pt.priority,
            "status":            pt.status,
            "created_ticket_id": str(pt.created_ticket_id) if pt.created_ticket_id else None,
            "created_at":        pt.created_at.isoformat(),
            "email_subject":     subj,
            "email_sender":      sender,
        }
        result.append(d)
    return result


async def update_pre_ticket(pt_id: str, body: UpdatePreTicketRequest, db: AsyncSession, user: User) -> dict:
    r = await db.execute(select(PreTicket).where(PreTicket.id == pt_id, PreTicket.creator_id == user.id))
    pt = r.scalar_one_or_none()
    if not pt:
        raise HTTPException(status_code=404, detail="预工单不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(pt, k, v)
    await db.commit()
    return {"message": "更新成功"}


async def approve_pre_ticket(pt_id: str, db: AsyncSession, user: User) -> dict:
    r = await db.execute(select(PreTicket).where(PreTicket.id == pt_id, PreTicket.creator_id == user.id))
    pt = r.scalar_one_or_none()
    if not pt:
        raise HTTPException(status_code=404, detail="预工单不存在")
    if pt.status != "pending_review":
        raise HTTPException(status_code=400, detail=f"当前状态为 {pt.status}，无法批准")

    ticket_no = await _generate_ticket_no(db)
    ticket = Ticket(
        ticket_no=ticket_no,
        title=pt.title,
        description=pt.description,
        customer_name=pt.customer_name,
        customer_contact=pt.customer_contact,
        product_name=pt.product_name,
        firmware_version=pt.firmware_version,
        priority=pt.priority,
        creator_id=user.id,
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)

    pt.status            = "approved"
    pt.created_ticket_id = ticket.id
    await db.commit()

    return {"message": "工单已创建", "ticket_no": ticket_no, "ticket_id": str(ticket.id)}


async def reject_pre_ticket(pt_id: str, db: AsyncSession, user: User) -> dict:
    r = await db.execute(select(PreTicket).where(PreTicket.id == pt_id, PreTicket.creator_id == user.id))
    pt = r.scalar_one_or_none()
    if not pt:
        raise HTTPException(status_code=404, detail="预工单不存在")
    pt.status = "rejected"
    await db.commit()
    return {"message": "已拒绝"}
