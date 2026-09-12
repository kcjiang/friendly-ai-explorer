from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models.user import User, UserRole
from app.schemas.user import CreateUserRequest, UpdateUserRequest
from app.services.auth_service import hash_password


# ── 用户管理 ─────────────────────────────────────────────────

async def list_users(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at))
    return list(result.scalars().all())


async def create_user(body: CreateUserRequest, db: AsyncSession) -> User:
    exists = await db.execute(select(User).where(User.email == body.email))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该邮箱已被注册")

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
        raise HTTPException(status_code=404, detail="用户不存在")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(user_id: str, operator_id: str, db: AsyncSession) -> dict:
    if str(user_id) == str(operator_id):
        raise HTTPException(status_code=400, detail="不能删除自己的账号")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    await db.delete(user)
    await db.commit()
    return {"message": "删除成功"}


async def reset_password(user_id: str, new_password: str, db: AsyncSession) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.password_hash = hash_password(new_password)
    await db.commit()
    return {"message": "密码重置成功"}


# ── 系统配置 ─────────────────────────────────────────────────

from app.models.user import User
from sqlalchemy import text


async def list_configs(db: AsyncSession) -> list[dict]:
    result = await db.execute(text("SELECT key, value, description FROM system_configs ORDER BY key"))
    return [{"key": r.key, "value": r.value, "description": r.description} for r in result.fetchall()]


async def update_config(key: str, value: str, operator_id: str, db: AsyncSession) -> dict:
    await db.execute(
        text("UPDATE system_configs SET value = :value, updated_by = :uid, updated_at = NOW() WHERE key = :key"),
        {"value": value, "key": key, "uid": operator_id},
    )
    await db.commit()
    return {"key": key, "value": value}


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
            "id":            str(r.id),
            "action":        r.action,
            "resource_type": r.resource_type,
            "user_name":     r.user_name,
            "user_email":    r.user_email,
            "created_at":    r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
