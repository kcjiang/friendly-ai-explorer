import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.i18n import message as system_message
from app.models.preset import PresetCommand, UploadedLog
from app.models.user import User, UserRole
from app.schemas.preset import CreatePresetRequest, UpdatePresetRequest

# ── 预制命令 ──────────────────────────────────────────────────


async def list_presets(
    device_type: str, db: AsyncSession, user: User
) -> list[PresetCommand]:
    """返回：公共命令 + 当前用户的个人命令"""
    result = await db.execute(
        select(PresetCommand)
        .where(
            PresetCommand.device_type == device_type,
            or_(
                PresetCommand.is_public.is_(True),
                PresetCommand.owner_id == user.id,
            ),
        )
        .order_by(
            PresetCommand.is_public.desc(), PresetCommand.group_name, PresetCommand.name
        )
    )
    return list(result.scalars().all())


async def create_preset(
    body: CreatePresetRequest, db: AsyncSession, user: User
) -> PresetCommand:
    # 只有开发者可以创建公共命令
    if body.is_public and user.role != UserRole.developer:
        raise HTTPException(
            status_code=403,
            detail=system_message("errors.onlyDevelopersCanCreatePublicCommands"),
        )

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


async def update_preset(
    preset_id: str, body: UpdatePresetRequest, db: AsyncSession, user: User
) -> PresetCommand:
    result = await db.execute(
        select(PresetCommand).where(PresetCommand.id == preset_id)
    )
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(
            status_code=404, detail=system_message("errors.commandNotFound")
        )

    # 公共命令只有开发者可以修改；个人命令只有本人可以修改
    if preset.is_public and user.role != UserRole.developer:
        raise HTTPException(
            status_code=403,
            detail=system_message("errors.onlyDevelopersCanEditPublicCommands"),
        )
    if not preset.is_public and preset.owner_id != user.id:
        raise HTTPException(
            status_code=403,
            detail=system_message("errors.youCannotEditAnotherUserSCommand"),
        )

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(preset, k, v)
    preset.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(preset)
    return preset


async def delete_preset(preset_id: str, db: AsyncSession, user: User) -> dict:
    result = await db.execute(
        select(PresetCommand).where(PresetCommand.id == preset_id)
    )
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(
            status_code=404, detail=system_message("errors.commandNotFound")
        )

    if preset.is_public and user.role != UserRole.developer:
        raise HTTPException(
            status_code=403,
            detail=system_message("errors.onlyDevelopersCanDeletePublicCommands"),
        )
    if not preset.is_public and preset.owner_id != user.id:
        raise HTTPException(
            status_code=403,
            detail=system_message("errors.youCannotDeleteAnotherUserSCommand"),
        )

    await db.delete(preset)
    await db.commit()
    return {"message": system_message("errors.deleteSuccess")}


# ── 日志上传 ──────────────────────────────────────────────────


async def upload_log(
    file: UploadFile,
    device_type: str,
    description: str,
    db: AsyncSession,
    user: User,
) -> UploadedLog:
    from app.services import storage_service as storage

    staged, size, digest = await storage.stage_upload(file, db=db, purpose="log")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{device_type}_{ts}_{uuid.uuid4().hex[:6]}.txt"
    target = None
    try:
        if device_type not in ("adb", "serial"):
            raise HTTPException(400, "Unsupported device type")
        await storage.lock(db)
        space = storage.personal(user)
        root = storage.disk_path(space)
        root.mkdir(parents=True, exist_ok=True)
        folder = root / "设备日志"
        if folder.exists() and not folder.is_dir():
            storage.fail(409, "个人空间中“设备日志”已被同名文件占用")
        if not folder.exists():
            await storage.create_folder(db, user, space, "", "设备日志")
        entry = await storage.commit_upload(
            db, user, space, "设备日志", filename, staged, size, digest, "keep"
        )
        target = storage.disk_path(entry.space, entry.path)
        content = target.read_text(encoding="utf-8", errors="replace")
        log = UploadedLog(
            user_id=user.id,
            device_type=device_type,
            filename=Path(entry.path).name,
            file_path=str(target),
            file_size=size,
            line_count=content.count("\n")
            + (1 if content and not content.endswith("\n") else 0),
            description=description or None,
            storage_entry_id=entry.id,
        )
        db.add(log)
        await db.commit()
        await db.refresh(log)
        return log
    except BaseException:
        if target:
            target.unlink(missing_ok=True)
        raise
    finally:
        staged.unlink(missing_ok=True)


async def list_logs(
    device_type: str, db: AsyncSession, user: User, page=None, page_size=10, query=""
):
    """Personal logs remain private, including from developers."""
    from app.models.storage import StorageEntry

    q = (
        select(UploadedLog, StorageEntry)
        .join(StorageEntry, UploadedLog.storage_entry_id == StorageEntry.id)
        .where(
            UploadedLog.device_type == device_type,
            UploadedLog.user_id == user.id,
            StorageEntry.space == f"personal/{user.id}",
            StorageEntry.trash_id.is_(None),
        )
    )
    if query:
        q = q.where(
            func.regexp_replace(StorageEntry.path, "^.*/", "").ilike(
                "%"
                + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                + "%",
                escape="\\",
            )
        )
    total = await db.scalar(select(func.count()).select_from(q.subquery()))
    q = q.order_by(UploadedLog.created_at.desc(), UploadedLog.id)
    if page:
        q = q.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(q)).all()
    items = [
        {
            "id": str(log.id),
            "device_type": log.device_type,
            "filename": Path(entry.path).name,
            "file_size": entry.size,
            "line_count": log.line_count,
            "description": log.description,
            "created_at": log.created_at.isoformat(),
            "uploader_name": user.name,
        }
        for log, entry in rows
    ]
    return {"items": items, "total": total, "page": page} if page else items


async def delete_log(log_id: str, db: AsyncSession, user: User) -> dict:
    result = await db.execute(select(UploadedLog).where(UploadedLog.id == log_id))
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(
            status_code=404, detail=system_message("errors.logNotFound")
        )
    if log.user_id != user.id:
        raise HTTPException(
            status_code=403, detail=system_message("errors.deletionIsNotPermitted")
        )

    from app.services import storage_service as storage

    await storage.lock(db)
    if not log.storage_entry_id:
        storage.fail(409, "日志尚未迁移到个人空间")
    entry = await storage.entry_for(db, log.storage_entry_id, user, write=True)
    await storage.delete_entry(db, user, entry)
    return {"message": system_message("errors.deleteSuccess")}
