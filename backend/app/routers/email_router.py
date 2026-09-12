from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser
from app.schemas.email_schema import (
    EmailAccountSetup, EmailAccountOut, SyncedEmailOut, SyncRequest, UpdatePreTicketRequest
)
from app.services import email_service

router = APIRouter()


@router.get("/account", summary="获取当前用户的邮件账号")
async def get_account(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    acct = await email_service.get_account(db, current_user)
    if not acct:
        return None
    return EmailAccountOut.model_validate(acct)


@router.post("/account", summary="配置 IMAP 账号（会自动测试连接）")
async def setup_account(
    body: EmailAccountSetup,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    acct = await email_service.setup_account(body, db, current_user)
    return EmailAccountOut.model_validate(acct)


@router.delete("/account", summary="删除邮件账号")
async def delete_account(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await email_service.delete_account(db, current_user)


@router.post("/sync", summary="手动同步邮件并触发 AI 分析")
async def sync_emails(
    body: SyncRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await email_service.sync_emails(body.limit, db, current_user)


@router.get("/emails", response_model=list[SyncedEmailOut], summary="获取已同步的邮件列表")
async def list_emails(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await email_service.list_emails(db, current_user)


@router.get("/pre-tickets", summary="获取预创建工单列表")
async def list_pre_tickets(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await email_service.list_pre_tickets(db, current_user)


@router.patch("/pre-tickets/{pt_id}", summary="修改预工单字段")
async def update_pre_ticket(
    pt_id: str,
    body: UpdatePreTicketRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await email_service.update_pre_ticket(pt_id, body, db, current_user)


@router.post("/pre-tickets/{pt_id}/approve", summary="批准预工单 → 创建真实工单")
async def approve(pt_id: str, current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await email_service.approve_pre_ticket(pt_id, db, current_user)


@router.post("/pre-tickets/{pt_id}/reject", summary="拒绝预工单")
async def reject(pt_id: str, current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await email_service.reject_pre_ticket(pt_id, db, current_user)
