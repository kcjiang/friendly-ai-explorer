"""Durable, owner-bound sequential upload sessions and quota reservations."""

import asyncio
import hashlib
import json
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.config import settings
from app.models.storage import StorageEntry, UploadTask
from app.services import device_logs
from app.services import storage_service as s
from app.services.storage_media import IMAGE_FORMATS, thumbnail_path, validate_image

DEFAULT_LIMITS = {
    "storage": 2048,
    "knowledge": 10,
    "log": 20,
    "image": 20,
    "attachment": 200,
    "video": 2048,
}
CHUNK_SIZE = 8 * 1024**2
THRESHOLD = 50 * 1024**2
TTL = timedelta(hours=48)


async def policy(db):
    config = await s.get_settings(db)
    return {**DEFAULT_LIMITS, **(config.upload_limits or {})}


async def file_limit(db, purpose, filename):
    limits = await policy(db)
    limit = limits[purpose if purpose in limits else "storage"]
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_FORMATS:
        limit = min(limit, limits["image"])
    elif ext in (".mp4", ".webm", ".mov", ".mkv", ".avi", ".ogg") and purpose not in (
        "knowledge",
        "log",
    ):
        limit = limits["video"]
    return limit * 1024**2


def parts_root(task_id):
    return Path(settings.storage_dir).resolve() / "upload-parts" / str(task_id)


def describe(task):
    return {
        "id": str(task.id),
        "filename": task.filename,
        "size": task.size,
        "space": task.space,
        "parent": task.parent,
        "purpose": task.purpose,
        "status": task.status,
        "chunk_size": task.chunk_size,
        "parts": task.parts,
        "fingerprint": task.fingerprint,
        "entry_id": str(task.entry_id) if task.entry_id else None,
        "expires_at": task.expires_at,
        "context": task.context,
    }


async def owned(db, user, task_id, *, allow_expired=False):
    task = await db.scalar(
        select(UploadTask)
        .where(UploadTask.id == task_id, UploadTask.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not task:
        s.fail(404, "上传任务不存在")
    if (
        not allow_expired
        and task.status == "active"
        and task.expires_at < datetime.now(timezone.utc)
    ):
        s.fail(410, "上传任务已过期，请重新上传")
    return task


async def authorize_context(db, user, task):
    if task.purpose == "attachment" and task.context.get("ticket_id"):
        from app.models.ticket import Ticket
        from app.services.ticket_service import require_edit

        ticket = await db.get(Ticket, uuid.UUID(task.context["ticket_id"]))
        if not ticket:
            s.fail(404, "文件不存在")
        require_edit(ticket, user)


async def create(db, user, body):
    s.name_only(body.filename)
    s.clean_path(body.parent)
    if body.purpose == "knowledge" and Path(body.filename).suffix.lower() not in (
        ".md",
        ".markdown",
    ):
        s.fail(400, "知识库仅支持 UTF-8 Markdown 文件")
    limit = await file_limit(db, body.purpose, body.filename)
    if body.size > limit:
        s.fail(413, "文件超过上传大小上限")
    space = (
        "knowledge"
        if body.purpose == "knowledge"
        else f"draft/{user.id}"
        if body.purpose == "attachment"
        else s.personal(user)
        if body.space == "personal"
        else "public"
    )
    if body.purpose == "log":
        space = s.personal(user)
        if body.device_type not in ("adb", "serial"):
            s.fail(400, "无效空间")
    await s.lock(db)
    if (
        body.purpose in ("storage", "knowledge")
        and body.parent
        and not s.disk_path(space, body.parent).is_dir()
    ):
        s.fail(404, "目标文件夹不存在")
    if body.upload_id:
        existing = await db.get(UploadTask, body.upload_id)
        if existing:
            if (
                existing.user_id != user.id
                or existing.fingerprint != body.fingerprint
                or existing.space != space
                or existing.parent != body.parent
                or existing.purpose != body.purpose
            ):
                s.fail(409, "上传任务状态已改变，请刷新")
            return existing
    task = UploadTask(
        id=body.upload_id or uuid.uuid4(),
        user_id=user.id,
        purpose=body.purpose,
        space=space,
        parent=body.parent,
        filename=body.filename,
        size=body.size,
        fingerprint=body.fingerprint,
        chunk_size=CHUNK_SIZE if body.size > THRESHOLD else max(1, body.size),
        parts=[],
        status="active",
        conflict=body.conflict,
        expires_at=datetime.now(timezone.utc) + TTL,
        context={
            "ticket_id": str(body.ticket_id) if body.ticket_id else None,
            "device_type": body.device_type,
            "description": body.description,
            "log_filename": device_logs.log_name(
                body.device_type,
                body.filename,
                offset=body.client_timezone_offset_minutes,
            )
            if body.purpose == "log"
            else None,
        },
    )
    await authorize_context(db, user, task)
    extra = 512 * 1024 if Path(body.filename).suffix.lower() in IMAGE_FORMATS else 0
    await s.check_quota(db, user, space, body.size + extra)
    # Reserve against remaining physical capacity too; bytes already staged are
    # subtracted to avoid counting them twice when the disk reports free bytes.
    others = (
        await db.scalars(
            select(UploadTask).where(
                UploadTask.status == "active",
                UploadTask.expires_at > datetime.now(timezone.utc),
            )
        )
    ).all()
    pending = sum(
        max(
            0,
            2 * t.size
            + max(0, t.reserved_bytes - t.size)
            - sum(p["size"] for p in t.parts),
        )
        for t in others
    )
    base = Path(settings.storage_dir).resolve()
    if (
        shutil.disk_usage(base).free - pending - 2 * body.size - extra
        < settings.storage_reserve_mb * 1024**2
    ):
        s.fail(507, "服务器可用磁盘空间不足")
    task.reserved_bytes = body.size + extra
    db.add(task)
    await db.commit()
    return task


async def write_part(db, user, task_id, index, expected, request):
    task = await owned(db, user, task_id)
    await authorize_context(db, user, task)
    if task.status != "active":
        s.fail(409, "上传任务状态已改变，请刷新")
    if index > len(task.parts):
        s.fail(409, "分片顺序不正确，请重新同步进度")
    if index < len(task.parts):
        if task.parts[index]["sha256"] != expected:
            s.fail(409, "所选文件与原上传文件不一致")
        return task
    offset = sum(p["size"] for p in task.parts)
    length = min(task.chunk_size, task.size - offset)
    if length <= 0:
        s.fail(409, "分片顺序不正确，请重新同步进度")
    directory = parts_root(task.id)
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / f"{index}.writing"
    target = directory / f"{index}.part"
    count = 0
    digest = hashlib.sha256()
    try:
        import aiofiles

        async with aiofiles.open(temporary, "wb") as file:
            async for chunk in request.stream():
                count += len(chunk)
                if count > length:
                    s.fail(413, "文件超过上传大小上限")
                if (
                    shutil.disk_usage(directory).free - len(chunk)
                    < settings.storage_reserve_mb * 1024**2
                ):
                    s.fail(507, "服务器磁盘空间不足")
                await file.write(chunk)
                digest.update(chunk)
        if count != length or digest.hexdigest() != expected:
            s.fail(409, "分片校验失败，请重试")
        temporary.replace(target)
        task.parts = [*task.parts, {"size": count, "sha256": expected}]
        task.expires_at = datetime.now(timezone.utc) + TTL
        await db.commit()
        return task
    finally:
        temporary.unlink(missing_ok=True)


def merge(task, destination):
    digest = hashlib.sha256()
    with destination.open("wb") as output:
        for index, part in enumerate(task.parts):
            check = hashlib.sha256()
            with (parts_root(task.id) / f"{index}.part").open("rb") as source:
                while value := source.read(1024**2):
                    digest.update(value)
                    check.update(value)
                    output.write(value)
            if check.hexdigest() != part["sha256"]:
                s.fail(409, "分片校验失败，请重试")
    return digest.hexdigest()


async def finish(db, user, task_id):
    await s.lock(db)
    task = await owned(db, user, task_id)
    if task.status in ("complete", "skipped"):
        return task
    if task.status != "active" or sum(p["size"] for p in task.parts) != task.size:
        s.fail(409, "文件尚未上传完整")
    await authorize_context(db, user, task)
    folder = parts_root(task.id)
    folder.mkdir(parents=True, exist_ok=True)
    merged = folder / "merged"
    target = None
    entry = None
    try:
        # Parts remain available for resume. Merge uses a second copy briefly.
        if (
            shutil.disk_usage(folder).free - task.size
            < settings.storage_reserve_mb * 1024**2
        ):
            s.fail(507, "服务器可用磁盘空间不足")
        digest = await asyncio.to_thread(merge, task, merged)
        await asyncio.to_thread(validate_image, merged, task.filename)
        if task.purpose == "knowledge":
            try:
                merged.read_text(encoding="utf-8-sig")
            except UnicodeError:
                s.fail(400, "Markdown 文件必须使用 UTF-8 编码")
        parent = task.parent
        name = task.filename
        if task.purpose == "attachment":
            parent = str(task.id)
            s.disk_path(task.space, parent).mkdir(parents=True, exist_ok=True)
        if task.purpose == "log":
            name = task.context.get("log_filename") or device_logs.log_name(
                task.context["device_type"], task.filename, at=task.created_at
            )
            parent, name = await device_logs.destination(
                db, user, task.space, task.context["device_type"], name
            )
        # Reservation becomes actual usage within the same locked transaction.
        task.reserved_bytes = 0
        await db.flush()
        directory = s.disk_path(task.space, parent)
        if not parent:
            directory.mkdir(parents=True, exist_ok=True)
        final_name = (
            s.available_name(directory, name) if task.conflict == "keep" else name
        )
        intended = "/".join(filter(None, [parent, final_name]))
        (folder / "receipt.json").write_text(
            json.dumps({"space": task.space, "path": intended, "sha256": digest}),
            encoding="utf-8",
        )
        entry = await s.commit_upload(
            db,
            user,
            task.space,
            parent,
            name,
            merged,
            task.size,
            digest,
            task.conflict,
            internal=task.purpose == "attachment",
        )
        if entry:
            target = s.disk_path(entry.space, entry.path)
            if task.purpose == "log":
                from app.models.preset import UploadedLog

                value = target.read_text(encoding="utf-8", errors="replace")
                db.add(
                    UploadedLog(
                        user_id=user.id,
                        device_type=task.context["device_type"],
                        filename=Path(entry.path).name,
                        file_path=str(target),
                        file_size=task.size,
                        description=task.context.get("description") or None,
                        line_count=value.count("\n")
                        + int(bool(value) and not value.endswith("\n")),
                        storage_entry_id=entry.id,
                    )
                )
            task.entry_id = entry.id
            task.filename = Path(entry.path).name
        task.status = "complete" if entry else "skipped"
        task.expires_at = datetime.now(timezone.utc) + TTL
        await db.commit()
    except BaseException:
        if target and target.exists():
            target.rename(merged)
        if entry:
            thumbnail_path(entry.id).unlink(missing_ok=True)
        raise
    finally:
        merged.unlink(missing_ok=True)
    shutil.rmtree(folder, ignore_errors=True)
    return task


async def cancel(db, user, task_id):
    await s.lock(db)
    task = await owned(db, user, task_id, allow_expired=True)
    if task.status == "complete" and task.entry_id:
        entry = await db.get(StorageEntry, task.entry_id)
        if entry and entry.space.startswith("draft/"):
            from app.services.storage_maintenance import drain_garbage, queue_entries

            await queue_entries(db, user, [entry], "cancel_attachment")
            task.entry_id = None
            await db.flush()
        elif entry:
            s.fail(409, "文件已保存，请在文件或工单入口管理")
    task.status = "cancelled"
    task.reserved_bytes = 0
    await db.commit()
    shutil.rmtree(parts_root(task.id), ignore_errors=True)
    from app.services.storage_maintenance import drain_garbage

    await drain_garbage(db)
    return task
