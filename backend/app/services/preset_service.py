import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiofiles
from fastapi import HTTPException, UploadFile
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.preset import PresetCommand, UploadedLog
from app.models.user import User, UserRole
from app.schemas.preset import CreatePresetRequest, UpdatePresetRequest


# ── 预制命令 ──────────────────────────────────────────────────

async def list_presets(device_type: str, db: AsyncSession, user: User) -> list[PresetCommand]:
    """返回：公共命令 + 当前用户的个人命令"""
    result = await db.execute(
        select(PresetCommand)
        .where(
            PresetCommand.device_type == device_type,
            or_(
                PresetCommand.is_public == True,
                PresetCommand.owner_id  == user.id,
            )
        )
        .order_by(PresetCommand.is_public.desc(), PresetCommand.group_name, PresetCommand.name)
    )
    return list(result.scalars().all())


async def create_preset(body: CreatePresetRequest, db: AsyncSession, user: User) -> PresetCommand:
    # 只有开发者可以创建公共命令
    if body.is_public and user.role != UserRole.developer:
        raise HTTPException(status_code=403, detail="只有开发者可以创建公共命令")

    preset = PresetCommand(
        name=body.name,
        command=body.command,
        group_name=body.group_name,
        device_type=body.device_type,
        is_public=body.is_public,
        is_danger=body.is_danger,
        owner_id=None if body.is_public else user.id,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset


async def update_preset(preset_id: str, body: UpdatePresetRequest, db: AsyncSession, user: User) -> PresetCommand:
    result = await db.execute(select(PresetCommand).where(PresetCommand.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="命令不存在")

    # 公共命令只有开发者可以修改；个人命令只有本人可以修改
    if preset.is_public and user.role != UserRole.developer:
        raise HTTPException(status_code=403, detail="只有开发者可以修改公共命令")
    if not preset.is_public and preset.owner_id != user.id:
        raise HTTPException(status_code=403, detail="无权修改他人的命令")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(preset, k, v)
    preset.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(preset)
    return preset


async def delete_preset(preset_id: str, db: AsyncSession, user: User) -> dict:
    result = await db.execute(select(PresetCommand).where(PresetCommand.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="命令不存在")

    if preset.is_public and user.role != UserRole.developer:
        raise HTTPException(status_code=403, detail="只有开发者可以删除公共命令")
    if not preset.is_public and preset.owner_id != user.id:
        raise HTTPException(status_code=403, detail="无权删除他人的命令")

    await db.delete(preset)
    await db.commit()
    return {"message": "删除成功"}


# ── 日志上传 ──────────────────────────────────────────────────

async def upload_log(
    file: UploadFile,
    device_type: str,
    description: str,
    db: AsyncSession,
    user: User,
) -> UploadedLog:
    log_dir = Path(settings.upload_dir) / "device_logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    ts        = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename  = f"{device_type}_{ts}_{uuid.uuid4().hex[:6]}.txt"
    file_path = log_dir / filename

    content = await file.read()
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    line_count = content.decode("utf-8", errors="replace").count("\n")

    log = UploadedLog(
        user_id=user.id,
        device_type=device_type,
        filename=filename,
        file_path=str(file_path),
        file_size=len(content),
        line_count=line_count,
        description=description or None,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log


async def list_logs(device_type: str, db: AsyncSession, user: User) -> list[dict]:
    """开发者可看全部，普通用户只看自己的"""
    q = select(UploadedLog).where(UploadedLog.device_type == device_type)
    if user.role != UserRole.developer:
        q = q.where(UploadedLog.user_id == user.id)
    q = q.order_by(UploadedLog.created_at.desc())

    result = await db.execute(q)
    logs = result.scalars().all()

    # 补充上传者姓名
    from app.models.user import User as UserModel
    user_ids = {str(l.user_id) for l in logs}
    names: dict[str, str] = {}
    if user_ids:
        users = await db.execute(select(UserModel).where(UserModel.id.in_(user_ids)))
        for u in users.scalars().all():
            names[str(u.id)] = u.name

    return [
        {
            "id":           str(l.id),
            "device_type":  l.device_type,
            "filename":     l.filename,
            "file_size":    l.file_size,
            "line_count":   l.line_count,
            "description":  l.description,
            "created_at":   l.created_at.isoformat(),
            "uploader_name":names.get(str(l.user_id), "未知"),
        }
        for l in logs
    ]


async def delete_log(log_id: str, db: AsyncSession, user: User) -> dict:
    result = await db.execute(select(UploadedLog).where(UploadedLog.id == log_id))
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="日志不存在")
    if log.user_id != user.id and user.role != UserRole.developer:
        raise HTTPException(status_code=403, detail="无权删除")

    if Path(log.file_path).exists():
        Path(log.file_path).unlink(missing_ok=True)
    await db.delete(log)
    await db.commit()
    return {"message": "删除成功"}
