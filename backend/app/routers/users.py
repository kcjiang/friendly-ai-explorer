"""
公开给所有已登录用户的用户接口。
主要用途：工单分配时的用户下拉列表。
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser
from app.schemas.user import UserOut
from app.services.admin_service import list_users

router = APIRouter()


@router.get("/", response_model=list[UserOut], summary="获取用户列表（用于下拉选择）")
async def get_users(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await list_users(db)
