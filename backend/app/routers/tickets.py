from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime
from uuid import UUID
from typing import Literal
from app.models.ticket import TicketStatus, TicketPriority
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser, LeaderOrDev
from app.schemas.ticket import (
    CreateTicketRequest, UpdateTicketRequest, AddCommentRequest,
    TicketListOut, TicketOut, TicketStatsOut, TicketCommentOut,
)
from app.services import ticket_service

router = APIRouter()


@router.get("/stats", summary="工单统计数据")
async def get_stats(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await ticket_service.get_stats(db, current_user)


@router.get("", response_model=list[TicketListOut], include_in_schema=False)
@router.get("/", response_model=list[TicketListOut], summary="获取工单列表")
async def list_tickets(current_user: AnyUser, db: AsyncSession = Depends(get_db),
                       mine: bool = False, q: str = Query('', max_length=200),
                       status: TicketStatus | None = None, priority: TicketPriority | None = None,
                       project_id: UUID | None = None, source: str = Query('', max_length=100),
                       sort: str = 'updated_at', direction: Literal['asc', 'desc'] = 'desc', assignee_id: UUID | None = None,
                       state: Literal['all', 'open', 'closed'] = 'all',
                       created_from: AwareDatetime | None = None, created_before: AwareDatetime | None = None):
    return await ticket_service.get_tickets(db, current_user, mine, q, status, priority, project_id, source, sort, direction, assignee_id, state=state, created_from=created_from, created_before=created_before)


@router.post("", response_model=TicketOut, status_code=201, include_in_schema=False)
@router.post("/", response_model=TicketOut, status_code=201, summary="新建工单")
async def create_ticket(
    body: CreateTicketRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await ticket_service.create_ticket(body, db, current_user)


@router.get("/{ticket_id}", response_model=TicketOut, summary="工单详情")
async def get_ticket(
    ticket_id: UUID,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await ticket_service.get_ticket(ticket_id, db, current_user)


@router.patch("/{ticket_id}", response_model=TicketOut, summary="更新工单")
async def update_ticket(
    ticket_id: UUID,
    body: UpdateTicketRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await ticket_service.update_ticket(ticket_id, body, db, current_user)


@router.delete("/{ticket_id}", summary="删除工单（检查记录权限及版本）")
async def delete_ticket(
    ticket_id: UUID,
    current_user: AnyUser,
    revision: int = Query(ge=1),
    db: AsyncSession = Depends(get_db),
):
    return await ticket_service.delete_ticket(ticket_id, db, current_user, revision)


@router.post("/{ticket_id}/comments", response_model=TicketCommentOut, status_code=201, summary="添加评论")
async def add_comment(
    ticket_id: UUID,
    body: AddCommentRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await ticket_service.add_comment(ticket_id, body, db, current_user)
