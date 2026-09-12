from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser
from app.schemas.user import LoginRequest, LoginResponse, ChangePasswordRequest, UserOut
from app.services import auth_service

router = APIRouter()


@router.post("/login", response_model=LoginResponse, summary="登录")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    使用邮箱 + 密码登录，返回 JWT access_token 和用户信息。
    """
    return await auth_service.login(body.email, body.password, db)


@router.get("/me", response_model=UserOut, summary="获取当前用户信息")
async def me(current_user: AnyUser):
    """
    需要携带 Bearer Token，返回当前登录用户的详细信息。
    """
    return current_user


@router.post("/change-password", summary="修改密码")
async def change_password(
    body: ChangePasswordRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    """
    修改当前登录用户的密码。
    """
    return await auth_service.change_password(
        current_user, body.old_password, body.new_password, db
    )
