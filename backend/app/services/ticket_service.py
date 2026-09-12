from datetime import datetime, timezone
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models.ticket import Ticket, TicketComment, TicketStatus
from app.models.user import User, UserRole
from app.schemas.ticket import CreateTicketRequest, UpdateTicketRequest, AddCommentRequest


# ── 工单号生成 ────────────────────────────────────────────────

async def _generate_ticket_no(db: AsyncSession) -> str:
    result = await db.execute(text("SELECT nextval('ticket_seq')"))
    seq = result.scalar()
    return f"KC-{datetime.now().year}-{seq:04d}"


# ── 公共查询（含关联数据） ────────────────────────────────────

def _ticket_query_with_relations():
    return select(Ticket).options(
        selectinload(Ticket.creator),
        selectinload(Ticket.assignee),
        selectinload(Ticket.comments).selectinload(TicketComment.author),
    )


# ── CRUD ─────────────────────────────────────────────────────

async def get_tickets(db: AsyncSession, user: User) -> list[Ticket]:
    q = (
        select(Ticket)
        .options(selectinload(Ticket.creator), selectinload(Ticket.assignee))
        .order_by(Ticket.created_at.desc())
    )
    # 工程师只能看自己创建或被分配的工单
    if user.role == UserRole.engineer:
        q = q.where(
            (Ticket.creator_id == user.id) | (Ticket.assignee_id == user.id)
        )
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_ticket(ticket_id: str, db: AsyncSession, user: User) -> Ticket:
    result = await db.execute(
        _ticket_query_with_relations().where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="工单不存在")
    if user.role == UserRole.engineer:
        if ticket.creator_id != user.id and ticket.assignee_id != user.id:
            raise HTTPException(status_code=403, detail="无权访问此工单")
    return ticket


async def create_ticket(body: CreateTicketRequest, db: AsyncSession, user: User) -> Ticket:
    ticket_no = await _generate_ticket_no(db)
    ticket = Ticket(
        ticket_no=ticket_no,
        creator_id=user.id,
        **body.model_dump(),
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)
    # 重新查询以加载关联数据
    return await get_ticket(str(ticket.id), db, user)


async def update_ticket(ticket_id: str, body: UpdateTicketRequest, db: AsyncSession, user: User) -> Ticket:
    ticket = await get_ticket(ticket_id, db, user)

    if user.role == UserRole.engineer and ticket.creator_id != user.id:
        raise HTTPException(status_code=403, detail="只能修改自己创建的工单")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ticket, k, v)

    # 状态变为 resolved 时记录时间
    if body.status == TicketStatus.resolved and not ticket.resolved_at:
        ticket.resolved_at = datetime.now(timezone.utc)

    ticket.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_ticket(ticket_id, db, user)


async def delete_ticket(ticket_id: str, db: AsyncSession, user: User) -> dict:
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="工单不存在")
    await db.delete(ticket)
    await db.commit()
    return {"message": "删除成功"}


async def add_comment(ticket_id: str, body: AddCommentRequest, db: AsyncSession, user: User) -> TicketComment:
    # 确认工单存在且有访问权限
    await get_ticket(ticket_id, db, user)

    comment = TicketComment(
        ticket_id=ticket_id,
        author_id=user.id,
        content=body.content,
        is_internal=body.is_internal,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    result = await db.execute(
        select(TicketComment)
        .options(selectinload(TicketComment.author))
        .where(TicketComment.id == comment.id)
    )
    return result.scalar_one()


async def get_stats(db: AsyncSession, user: User) -> dict:
    tickets = await get_tickets(db, user)
    stats: dict = {"total": len(tickets), "open": 0, "in_progress": 0, "pending": 0, "resolved": 0, "closed": 0}
    for t in tickets:
        stats[t.status.value] += 1
    return stats
