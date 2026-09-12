from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import DevOnly
from app.schemas.user import CreateUserRequest, UpdateUserRequest, UserOut
from app.services import admin_service

router = APIRouter()


# ── 用户管理 ─────────────────────────────────────────────────

@router.get("/users", response_model=list[UserOut], summary="获取所有用户")
async def list_users(current_user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await admin_service.list_users(db)


@router.post("/users", response_model=UserOut, status_code=201, summary="新建用户")
async def create_user(
    body: CreateUserRequest,
    current_user: DevOnly,
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.create_user(body, db)


@router.patch("/users/{user_id}", response_model=UserOut, summary="更新用户信息/角色")
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    current_user: DevOnly,
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.update_user(user_id, body, db)


@router.delete("/users/{user_id}", summary="删除用户")
async def delete_user(
    user_id: str,
    current_user: DevOnly,
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.delete_user(user_id, str(current_user.id), db)


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password", summary="重置用户密码")
async def reset_password(
    user_id: str,
    body: ResetPasswordRequest,
    current_user: DevOnly,
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.reset_password(user_id, body.new_password, db)


# ── 系统配置 ─────────────────────────────────────────────────

class UpdateConfigRequest(BaseModel):
    value: str


@router.get("/configs", summary="获取系统配置")
async def list_configs(current_user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await admin_service.list_configs(db)


@router.patch("/configs/{key}", summary="更新系统配置")
async def update_config(
    key: str,
    body: UpdateConfigRequest,
    current_user: DevOnly,
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.update_config(key, body.value, str(current_user.id), db)


# ── 审计日志 ─────────────────────────────────────────────────

@router.get("/audit-logs", summary="审计日志")
async def list_audit_logs(current_user: DevOnly, db: AsyncSession = Depends(get_db)):
    return await admin_service.list_audit_logs(db)
