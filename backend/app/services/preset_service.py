from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.i18n import message as system_message
from app.models.preset import UploadedLog
from app.models.user import User
from app.services import device_logs

# ── 日志上传 ──────────────────────────────────────────────────


async def upload_log(
    file: UploadFile,
    device_type: str,
    description: str,
    db: AsyncSession,
    user: User,
    client_timezone_offset_minutes: int = -480,
) -> UploadedLog:
    from app.services import storage_service as storage

    filename = device_logs.log_name(
        device_type, file.filename, offset=client_timezone_offset_minutes
    )
    staged, size, digest = await storage.stage_upload(file, db=db, purpose="log")
    target = None
    try:
        if device_type not in ("adb", "serial"):
            raise HTTPException(400, "Unsupported device type")
        await storage.lock(db)
        space = storage.personal(user)
        parent, filename = await device_logs.destination(
            db, user, space, device_type, filename
        )
        entry = await storage.commit_upload(
            db, user, space, parent, filename, staged, size, digest, "keep"
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
    device_type: str | None,
    db: AsyncSession,
    user: User,
    page=None,
    page_size=10,
    query="",
):
    """Personal logs remain private, including from developers."""
    from app.models.storage import StorageEntry

    q = (
        select(UploadedLog, StorageEntry)
        .select_from(StorageEntry)
        .outerjoin(
            UploadedLog,
            (UploadedLog.storage_entry_id == StorageEntry.id)
            & (UploadedLog.user_id == user.id),
        )
        .where(
            StorageEntry.space == f"personal/{user.id}",
            StorageEntry.trash_id.is_(None),
            StorageEntry.is_dir.is_(False),
            StorageEntry.path.startswith("DeviceLogs/"),
        )
    )
    if device_type:
        q = q.where(UploadedLog.device_type == device_type)
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
    q = q.order_by(
        func.coalesce(UploadedLog.created_at, StorageEntry.created_at).desc(),
        StorageEntry.id,
    )
    if page:
        q = q.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(q)).all()
    items = [
        {
            "id": str(log.id if log else entry.id),
            "storage_entry_id": str(entry.id),
            "device_type": log.device_type if log else None,
            "filename": Path(entry.path).name,
            "file_size": entry.size,
            "line_count": log.line_count if log else None,
            "description": log.description if log else None,
            "created_at": (log.created_at if log else entry.created_at).isoformat(),
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
