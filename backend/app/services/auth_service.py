from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.models.user import User
from app.middleware.auth import create_access_token
from app.schemas.user import LoginResponse, UserOut

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_ctx.hash(plain)


async def login(email: str, password: str, db: AsyncSession) -> LoginResponse:
    """验证账号密码，返回 JWT + 用户信息"""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用",
        )

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return LoginResponse(access_token=token, user=UserOut.model_validate(user))


async def change_password(
    user: User,
    old_password: str,
    new_password: str,
    db: AsyncSession,
) -> dict:
    """修改密码"""
    if not verify_password(old_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="原密码错误",
        )
    user.password_hash = hash_password(new_password)
    await db.commit()
    return {"message": "密码修改成功"}
