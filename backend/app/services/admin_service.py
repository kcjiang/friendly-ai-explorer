from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.i18n import message as system_message
from app.models.user import User
from app.schemas.user import CreateUserRequest, UpdateUserRequest
from app.services.auth_service import hash_password

# ── 用户管理 ─────────────────────────────────────────────────


async def list_users(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at))
    return list(result.scalars().all())


async def create_user(body: CreateUserRequest, db: AsyncSession) -> User:
    exists = await db.execute(select(User).where(User.email == body.email))
    if exists.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail=system_message("errors.thisEmailAddressIsAlreadyRegistered"),
        )

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update_user(user_id: str, body: UpdateUserRequest, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=404, detail=system_message("errors.userNotFound")
        )

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(user_id: str, operator_id: str, db: AsyncSession) -> dict:
    if str(user_id) == str(operator_id):
        raise HTTPException(
            status_code=400,
            detail=system_message("errors.youCannotDeleteYourOwnAccount"),
        )
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=404, detail=system_message("errors.userNotFound")
        )
    await db.delete(user)
    await db.commit()
    return {"message": system_message("errors.deleteSuccess")}


async def reset_password(user_id: str, new_password: str, db: AsyncSession) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=404, detail=system_message("errors.userNotFound")
        )
    user.password_hash = hash_password(new_password)
    await db.commit()
    return {"message": system_message("errors.passwordReset")}


# ── 审计日志 ─────────────────────────────────────────────────


async def list_audit_logs(db: AsyncSession, limit: int = 100) -> list[dict]:
    result = await db.execute(
        text("""
            SELECT al.id, al.action, al.resource_type, al.resource_id,
                   al.details, al.ip_address, al.created_at,
                   u.name as user_name, u.email as user_email
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.created_at DESC
            LIMIT :limit
        """),
        {"limit": limit},
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r.id),
            "action": r.action,
            "resource_type": r.resource_type,
            "user_name": r.user_name,
            "user_email": r.user_email,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
