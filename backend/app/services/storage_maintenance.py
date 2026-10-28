"""Recover uploads, retry committed deletions, expire only known temporary data."""

import asyncio
import hashlib
import json
import logging
import re
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.config import settings
from app.models.storage import FileGarbage, StorageEntry, UploadTask
from app.models.user import User
from app.services import storage_service as s
from app.services.storage_media import prepare_entry, thumbnail_path

logger = logging.getLogger(__name__)


async def queue_entries(db, user, entries, action="delete"):
    for entry in entries:
        path = s.disk_path(entry.space, entry.path, entry.trash_id)
        owner = None
        if entry.space.startswith("personal/"):
            owner = uuid.UUID(entry.space.split("/")[1])
        db.add(
            FileGarbage(
                path=str(path),
                size=0 if entry.is_dir else entry.size,
                charged_user_id=owner,
                pooled=entry.space != "knowledge",
            )
        )
        if entry.thumbnail_size:
            db.add(
                FileGarbage(
                    path=str(thumbnail_path(entry.id)),
                    size=entry.thumbnail_size,
                    charged_user_id=owner,
                    pooled=entry.space != "knowledge",
                )
            )
        if entry.document_id:
            archive = Path(settings.storage_dir) / "knowledge-originals"
            for original in archive.glob(str(entry.document_id) + ".*"):
                db.add(
                    FileGarbage(
                        path=str(original), size=original.stat().st_size, pooled=False
                    )
                )
    await s.remove_records(db, user, entries, action)


async def drain_garbage(db):
    await s.lock(db)
    rows = (await db.scalars(select(FileGarbage))).all()
    entries = (await db.scalars(select(StorageEntry))).all()
    live = {str(s.disk_path(e.space, e.path, e.trash_id)) for e in entries}
    live.update(str(thumbnail_path(e.id)) for e in entries)
    base = Path(settings.storage_dir).resolve()
    removed = 0
    for row in sorted(rows, key=lambda r: -len(r.path)):
        path = Path(row.path)
        try:
            if not path.resolve().is_relative_to(base) or path.is_symlink():
                logger.error("清理路径校验失败")
                continue
            if str(path) in live:
                await db.delete(row)
                continue
            # Never recursively erase a directory that may have been reused.
            if path.is_dir():
                path.rmdir()
            else:
                path.unlink(missing_ok=True)
            await db.delete(row)
            removed += 1
        except OSError:
            logger.warning(
                "文件清理失败，将在下轮重试",
                extra={"details": {"garbage_id": str(row.id)}},
            )
    for relative in ("recycle", "storage/attachment-drafts", "storage/tickets"):
        root = base / relative
        if root.exists():
            for path in sorted(root.rglob("*"), key=lambda p: -len(p.parts)):
                if path.is_dir() and not path.is_symlink() and str(path) not in live:
                    try:
                        path.rmdir()
                    except OSError:
                        pass
    await db.commit()
    return removed


async def reconcile(db):
    await s.lock(db)
    base = Path(settings.storage_dir).resolve()
    spaces = ["public", "knowledge"]
    for prefix, relative in (
        ("personal", "storage/personal"),
        ("ticket", "storage/tickets"),
        ("draft", "storage/attachment-drafts"),
    ):
        root = base / relative
        if root.exists():
            for folder in root.iterdir():
                if folder.is_dir() and re.fullmatch(r"[0-9a-f-]{36}", folder.name):
                    spaces.append(f"{prefix}/{folder.name}")
    pending = {g.path for g in (await db.scalars(select(FileGarbage))).all()}
    count = 0
    missing = 0
    for space in spaces:
        root = s.space_root(space)
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_symlink() or str(path) in pending:
                continue
            relative = path.relative_to(root).as_posix()
            if space.startswith(("draft/", "ticket/")) and path.is_dir():
                continue
            try:
                entry = await s.register(db, space, relative)
                if not entry.is_dir:
                    entry.size = path.stat().st_size
                    thumb = thumbnail_path(entry.id)
                    entry.thumbnail_size = thumb.stat().st_size if thumb.exists() else 0
                count += 1
            except Exception:
                logger.warning("外部文件暂无法登记", exc_info=False)
    for entry in (await db.scalars(select(StorageEntry))).all():
        if not s.disk_path(entry.space, entry.path, entry.trash_id).exists():
            missing += 1
    await db.commit()
    return {"scanned": count, "missing": missing}


async def recover_receipt(db, task):
    from app.services.upload_service import TTL, parts_root

    receipt = parts_root(task.id) / "receipt.json"
    if not receipt.exists():
        return False
    data = json.loads(receipt.read_text(encoding="utf-8"))
    if data["space"] != task.space:
        return False
    target = s.disk_path(task.space, data["path"])
    if not target.is_file():
        return False

    def digest():
        with target.open("rb") as file:
            return hashlib.file_digest(file, "sha256").hexdigest()

    if await asyncio.to_thread(digest) != data["sha256"]:
        return False
    user = await db.get(User, task.user_id)
    entry = await s.active(db, task.space, data["path"])
    if entry and entry.creator_id not in (None, user.id):
        return False
    entry = entry or await s.register(db, task.space, data["path"], user)
    entry.creator_id = user.id
    entry.sha256 = data["sha256"]
    await asyncio.to_thread(prepare_entry, entry)
    if task.purpose == "knowledge":
        await s.attach_document(db, user, entry)
    if task.purpose == "log":
        from app.models.preset import UploadedLog

        value = target.read_text(encoding="utf-8", errors="replace")
        db.add(
            UploadedLog(
                user_id=user.id,
                device_type=task.context["device_type"],
                filename=target.name,
                file_path=str(target),
                file_size=entry.size,
                line_count=value.count("\n")
                + int(bool(value) and not value.endswith("\n")),
                storage_entry_id=entry.id,
            )
        )
    task.entry_id = entry.id
    task.status = "complete"
    task.reserved_bytes = 0
    task.expires_at = datetime.now(timezone.utc) + TTL
    return True


async def sweep(db):
    from app.services.upload_service import parts_root

    await s.lock(db)
    transfer_root = Path(settings.storage_dir).resolve() / "attachment-transfers"
    if transfer_root.exists():
        for journal in transfer_root.glob("*.json"):
            try:
                value = json.loads(journal.read_text(encoding="utf-8"))
                entry = await db.get(StorageEntry, uuid.UUID(value["entry_id"]))
                old = s.disk_path(value["old_space"], value["old_path"])
                new = s.disk_path(value["space"], value["path"])
                if (
                    entry
                    and entry.space == value["space"]
                    and entry.path == value["path"]
                ):
                    journal.unlink(missing_ok=True)
                elif (
                    entry
                    and entry.space == value["old_space"]
                    and entry.path == value["old_path"]
                ):
                    if new.exists() and not old.exists():
                        old.parent.mkdir(parents=True, exist_ok=True)
                        new.rename(old)
                    if old.exists():
                        journal.unlink(missing_ok=True)
                elif not old.exists() and not new.exists():
                    journal.unlink(missing_ok=True)
            except (OSError, ValueError, KeyError):
                logger.warning("附件移动记录需要核查")
    now = datetime.now(timezone.utc)
    tasks = (
        await db.scalars(select(UploadTask).with_for_update(skip_locked=True))
    ).all()
    remove = []
    for task in tasks:
        if task.status == "review":
            continue
        if task.status == "active":
            try:
                if await recover_receipt(db, task):
                    remove.append(task.id)
                    continue
            except (OSError, ValueError, KeyError):
                logger.warning(
                    "上传恢复记录需要核查", extra={"details": {"task_id": str(task.id)}}
                )
            receipt = parts_root(task.id) / "receipt.json"
            if receipt.exists():
                try:
                    value = json.loads(receipt.read_text(encoding="utf-8"))
                    target = s.disk_path(task.space, value["path"])
                    if target.is_file():
                        entry = await s.active(db, task.space, value["path"])
                        if not entry:
                            entry = await s.register(db, task.space, value["path"])
                        task.status = "review"
                        task.reserved_bytes = 0
                        logger.error(
                            "上传恢复内容存在差异，已保留文件和恢复记录等待核查",
                            extra={"details": {"task_id": str(task.id)}},
                        )
                        continue
                except (OSError, ValueError, KeyError):
                    logger.error("上传恢复记录损坏，已保留等待核查")
                    task.status = "review"
                    continue
            if task.expires_at < now:
                task.status = "expired"
                task.reserved_bytes = 0
                remove.append(task.id)
        elif task.status == "complete" and task.expires_at < now and task.entry_id:
            entry = await db.get(StorageEntry, task.entry_id)
            if entry and entry.space.startswith("draft/"):
                user = await db.get(User, task.user_id)
                await queue_entries(db, user, [entry], "expired_attachment")
                task.entry_id = None
                task.status = "expired"
            remove.append(task.id)
        else:
            remove.append(task.id)
        if task.status != "active" and task.expires_at < now - timedelta(days=5):
            await db.delete(task)
    await db.commit()
    for task_id in remove:
        shutil.rmtree(parts_root(task_id), ignore_errors=True)
    root = Path(settings.storage_dir).resolve()
    known = {str(t.id) for t in tasks}
    parts = root / "upload-parts"
    if parts.exists():
        for folder in parts.iterdir():
            if (
                folder.name not in known
                and re.fullmatch(r"[0-9a-f-]{36}", folder.name)
                and now.timestamp() - folder.stat().st_mtime > 48 * 3600
            ):
                shutil.rmtree(folder, ignore_errors=True)
    temporary = root / "temporary"
    if temporary.exists():
        for path in temporary.iterdir():
            if (
                re.fullmatch(r"[0-9a-f]{32}", path.name)
                and path.is_file()
                and now.timestamp() - path.stat().st_mtime > 48 * 3600
            ):
                path.unlink(missing_ok=True)
    ids = {str(e) for e in (await db.scalars(select(StorageEntry.id))).all()}
    thumbnails = root / "thumbnails"
    if thumbnails.exists():
        for path in thumbnails.glob("*.webp"):
            if (
                path.stem not in ids
                and now.timestamp() - path.stat().st_mtime > 48 * 3600
            ):
                path.unlink(missing_ok=True)
    return await drain_garbage(db)


async def maintenance_loop():
    from app.database import AsyncSessionLocal

    cycle = 0
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await sweep(db)
                if cycle % 60 == 0:
                    result = await reconcile(db)
                    if result["missing"]:
                        logger.warning(
                            "文件记录与磁盘存在差异", extra={"details": result}
                        )
            cycle += 1
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("存储维护失败，将自动重试")
        await asyncio.sleep(60)
