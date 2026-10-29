"""Private filesystem storage. All mutations serialize on one PostgreSQL lock.

The lock also covers quota checks and renames across workers. Uploads stage outside
the lock; a staged file is never a visible or downloadable entry.
"""

import asyncio
import hashlib
import mimetypes
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

import aiofiles
from fastapi import HTTPException, UploadFile
from sqlalchemy import delete, func, select, text

from app.config import settings
from app.models.storage import (
    FileGarbage,
    FileOperation,
    StorageEntry,
    StorageSettings,
    StorageShare,
    UploadTask,
)
from app.models.user import User, UserRole


def fail(status, message):
    from app.i18n import message as localized

    code = "errors.storage" + hashlib.sha256(message.encode()).hexdigest()[:10]
    raise HTTPException(status, localized(code))


def clean_path(value):
    if not isinstance(value, str) or "\\" in value or value.startswith("/"):
        fail(400, "无效路径")
    parts = value.split("/") if value else []
    for part in parts:
        if (
            not part
            or part in (".", "..")
            or part.endswith((".", " "))
            or len(part.encode("utf-8")) > 240
            or re.search(r'[<>:"|?*\x00-\x1f]', part)
        ):
            fail(400, "文件名包含不支持的字符")
    if len(value.encode("utf-8")) > 1800:
        fail(400, "路径过长")
    return value


def name_only(name):
    clean_path(name)
    if not name or "/" in name:
        fail(400, "请输入有效名称")
    return name


def personal(user):
    return f"personal/{user.id}"


def space_root(space):
    base = Path(settings.storage_dir).resolve()
    if space == "public":
        return base / "storage" / "public"
    if space == "knowledge":
        return base / "knowledge"
    if re.fullmatch(r"personal/[0-9a-f-]{36}", space):
        return base / "storage" / space
    if re.fullmatch(r"ticket/[0-9a-f-]{36}", space):
        return base / "storage" / "tickets" / space.split("/")[1]
    if re.fullmatch(r"draft/[0-9a-f-]{36}", space):
        return base / "storage" / "attachment-drafts" / space.split("/")[1]
    fail(400, "无效空间")


def disk_path(space, path="", trash_id=None):
    clean_path(path)
    root = (
        (Path(settings.storage_dir).resolve() / "recycle" / str(trash_id))
        if trash_id
        else space_root(space)
    )
    target = root / path
    # Check every existing component; never follow symlinks, including space roots.
    base = Path(settings.storage_dir).resolve()
    current = base
    for part in target.relative_to(base).parts:
        current = current / part
        if current.is_symlink():
            fail(400, "不支持符号链接")
    if not target.resolve().is_relative_to(base):
        fail(400, "无效路径")
    return target


def can_write_space(space, user):
    return space in ("public", "knowledge") or space == personal(user)


def assert_write(space, user):
    if not can_write_space(space, user):
        fail(403, "无权操作此空间")


async def lock(db):
    await db.execute(text("SELECT pg_advisory_xact_lock(741891024)"))


def record(db, user, entry, action, **details):
    db.add(
        FileOperation(
            entry_id=entry.id,
            actor_id=user.id if user else None,
            space=entry.space,
            path=entry.path,
            action=action,
            details={"actor_name": user.name if user else None, **details},
        )
    )


async def active(db, space, path):
    return await db.scalar(
        select(StorageEntry).where(
            StorageEntry.space == space,
            StorageEntry.path == path,
            StorageEntry.trash_id.is_(None),
        )
    )


async def register(db, space, path, user=None):
    entry = await active(db, space, path)
    target = disk_path(space, path)
    if not target.exists():
        fail(404, "文件或文件夹不存在")
    if not entry:
        entry = StorageEntry(
            id=uuid.uuid4(),
            space=space,
            path=path,
            is_dir=target.is_dir(),
            size=0 if target.is_dir() else target.stat().st_size,
            creator_id=user.id if user else None,
        )
        db.add(entry)
        await db.flush()
        if not space.startswith(("draft/", "ticket/")):
            record(db, user, entry, "create" if user else "external_discovered")
    return entry


async def register_tree(db, space, path):
    target = disk_path(space, path)
    if target.is_dir():
        for child in sorted(target.rglob("*")):
            disk_path(space, child.relative_to(space_root(space)).as_posix())
            await register(db, space, child.relative_to(space_root(space)).as_posix())


async def subtree(db, entry):
    rows = (
        await db.scalars(
            select(StorageEntry).where(
                StorageEntry.space == entry.space,
                StorageEntry.trash_id == entry.trash_id,
            )
        )
    ).all()
    return [
        r for r in rows if r.path == entry.path or r.path.startswith(entry.path + "/")
    ]


def require_ticket_view(ticket, user):
    from app.services.ticket_service import can_view

    if not can_view(ticket, user):
        fail(404, "文件不存在")


async def assert_read(db, entry, user):
    if entry.trash_id:
        fail(404, "文件不存在")
    if entry.space.startswith("draft/"):
        if entry.creator_id == user.id:
            return
        fail(404, "文件不存在")
    if entry.ticket_id:
        from app.models.ticket import Ticket

        ticket = await db.get(Ticket, entry.ticket_id)
        require_ticket_view(ticket, user)
        return
    if can_write_space(entry.space, user):
        return
    grants = (
        await db.scalars(
            select(StorageEntry)
            .join(StorageShare, StorageShare.entry_id == StorageEntry.id)
            .where(
                StorageShare.user_id == user.id,
                StorageEntry.space == entry.space,
                StorageEntry.trash_id.is_(None),
            )
        )
    ).all()
    if any(
        entry.path == g.path or (g.is_dir and entry.path.startswith(g.path + "/"))
        for g in grants
    ):
        return
    fail(404, "文件不存在或未共享")


async def entry_for(db, entry_id, user, write=False):
    entry = await db.get(StorageEntry, entry_id)
    if not entry:
        fail(404, "文件不存在")
    if write:
        if entry.space.startswith(("ticket/", "draft/")):
            fail(403, "工单附件请在所属工单中管理")
        assert_write(entry.space, user)
        if entry.trash_id:
            fail(404, "文件已删除")
    else:
        await assert_read(db, entry, user)
    if not disk_path(entry.space, entry.path, entry.trash_id).exists():
        fail(404, "磁盘文件不存在")
    return entry


def available_name(directory, name, is_dir=False):
    if not (directory / name).exists():
        return name
    suffix = "" if is_dir else Path(name).suffix
    stem = name[: -len(suffix)] if suffix else name
    n = 2
    while (directory / f"{stem} ({n}){suffix}").exists():
        n += 1
    return f"{stem} ({n}){suffix}"


def tree_bytes(root):
    if not root.exists():
        return 0
    if root.is_symlink():
        fail(400, "不支持符号链接")
    if root.is_file():
        return root.stat().st_size
    total = 0
    for item in root.rglob("*"):
        if item.is_symlink():
            fail(400, "不支持符号链接")
        if item.is_file():
            total += item.stat().st_size
    return total


async def get_settings(db):
    row = await db.get(StorageSettings, 1)
    if not row:
        row = StorageSettings(
            id=1,
            total_bytes=100 * 1024**3,
            default_personal_bytes=5 * 1024**3,
            user_quotas={},
        )
        db.add(row)
        await db.flush()
    return row


async def usage(db, user):
    config = await get_settings(db)
    base = Path(settings.storage_dir).resolve()
    base.mkdir(parents=True, exist_ok=True)
    amount = StorageEntry.size + StorageEntry.thumbnail_size
    pooled = await db.scalar(
        select(func.coalesce(func.sum(amount), 0)).where(
            StorageEntry.space != "knowledge"
        )
    )
    mine = await db.scalar(
        select(func.coalesce(func.sum(amount), 0)).where(
            StorageEntry.space == personal(user)
        )
    )
    knowledge = await db.scalar(
        select(func.coalesce(func.sum(amount), 0)).where(
            StorageEntry.space == "knowledge"
        )
    )
    archive = base / "knowledge-originals"
    knowledge += await asyncio.to_thread(tree_bytes, archive)
    for garbage in (
        await db.scalars(select(FileGarbage).where(FileGarbage.pooled.is_(False)))
    ).all():
        path = Path(garbage.path)
        if not path.is_relative_to(archive) or not path.exists():
            knowledge += garbage.size
    reservations = select(func.coalesce(func.sum(UploadTask.reserved_bytes), 0)).where(
        UploadTask.status == "active",
        UploadTask.expires_at > datetime.now(timezone.utc),
        UploadTask.space != "knowledge",
    )
    reserved = await db.scalar(reservations)
    personal_reserved = await db.scalar(
        reservations.where(
            UploadTask.user_id == user.id, UploadTask.space == personal(user)
        )
    )
    pooled += await db.scalar(
        select(func.coalesce(func.sum(FileGarbage.size), 0)).where(
            FileGarbage.pooled.is_(True)
        )
    )
    mine += await db.scalar(
        select(func.coalesce(func.sum(FileGarbage.size), 0)).where(
            FileGarbage.charged_user_id == user.id
        )
    )
    free = shutil.disk_usage(base).free
    return {
        "total_bytes": config.total_bytes,
        "used_bytes": pooled,
        "personal_bytes": mine,
        "personal_limit": config.user_quotas.get(
            str(user.id), config.default_personal_bytes
        ),
        "knowledge_bytes": knowledge,
        "disk_free_bytes": free,
        "reserve_bytes": settings.storage_reserve_mb * 1024**2,
        "reserved_bytes": reserved,
        "personal_reserved_bytes": personal_reserved,
    }


async def check_quota(db, user, space, size, *, pooled_delta=None, staged=False):
    info = await usage(db, user)
    if space != "knowledge":
        delta = size if pooled_delta is None else pooled_delta
        if (
            delta > 0
            and info["used_bytes"] + info["reserved_bytes"] + delta
            > info["total_bytes"]
        ):
            fail(413, "存储空间总容量不足（公共回收站也占用容量）")
        if (
            space == personal(user)
            and size > 0
            and info["personal_bytes"] + info["personal_reserved_bytes"] + size
            > info["personal_limit"]
        ):
            fail(413, "个人空间配额不足")
    if (
        not staged
        and size > 0
        and info["disk_free_bytes"] - size < info["reserve_bytes"]
    ):
        fail(507, "服务器可用磁盘空间不足")
    if staged and info["disk_free_bytes"] < info["reserve_bytes"]:
        fail(507, "服务器可用磁盘空间不足")


async def list_entries(db, user, space, path="", shared_id=None):
    clean_path(path)
    if shared_id:
        root = await entry_for(db, shared_id, user)
        if not root.is_dir:
            return [await serialize(db, root)]
        space = root.space
        path = "/".join(filter(None, [root.path, path]))
        # Even '..' encoded by the client cannot escape this subtree.
        clean_path(path)
    else:
        assert_write(space, user)
    target = disk_path(space, path)
    if not target.exists() and not path:
        target.mkdir(parents=True, exist_ok=True)
    if not target.is_dir():
        fail(404, "文件夹不存在")
    if shared_id:
        check = await register(db, space, path)
        await assert_read(db, check, user)
    items = []
    for child in sorted(
        target.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold())
    ):
        rel = child.relative_to(space_root(space)).as_posix()
        if child.is_symlink():
            continue
        entry = await register(db, space, rel)
        if shared_id:
            await assert_read(db, entry, user)
        if not entry.is_dir:
            entry.size = child.stat().st_size
        items.append(await serialize(db, entry))
    return items


async def serialize(db, e):
    creator = await db.get(User, e.creator_id) if e.creator_id else None
    editors = (
        await db.execute(
            select(User.id, User.name)
            .join(FileOperation, FileOperation.actor_id == User.id)
            .where(
                FileOperation.entry_id == e.id,
                FileOperation.action.in_(["edit", "rename", "move"]),
            )
            .distinct()
        )
    ).all()
    result = {
        "id": str(e.id),
        "space": e.space,
        "path": e.path,
        "name": PurePosixPath(e.path).name,
        "is_dir": e.is_dir,
        "size": e.size,
        "sha256": e.sha256,
        "creator": {"id": str(creator.id), "name": creator.name} if creator else None,
        "modifiers": [{"id": str(i), "name": n} for i, n in editors],
        "created_at": e.created_at,
        "updated_at": e.updated_at,
        "deleted_at": e.deleted_at,
        "document_id": str(e.document_id) if e.document_id else None,
        "ticket_id": str(e.ticket_id) if e.ticket_id else None,
        "media_type": e.media_type,
        "thumbnail_size": e.thumbnail_size,
    }
    if e.document_id:
        from app.models.document import Document
        from app.services.knowledge_service import _index_states

        doc = await db.get(Document, e.document_id)
        if doc:
            await _index_states([doc], db)
            result["index_status"] = doc.index_status
    return result


async def write_text(db, user, entry, content, revision=None):
    """Edit an ordinary text file, including quota, metadata and rollback."""
    assert_write(entry.space, user)
    if entry.is_dir or Path(entry.path).suffix.lower() not in (
        ".md",
        ".markdown",
        ".json",
        ".sh",
    ):
        fail(400, "Unsupported editable file type")
    target = disk_path(entry.space, entry.path)
    original = target.read_bytes()
    if revision is not None and hashlib.sha256(original).hexdigest() != revision:
        from app.i18n import message as system_message

        raise HTTPException(409, system_message("errors.fileContentChanged"))
    value = content.encode("utf-8")
    if len(value) > 2_000_000:
        fail(413, "File exceeds 2 MB")
    await check_quota(db, user, entry.space, max(0, len(value) - len(original)))
    staged = target.with_name(".edit-" + uuid.uuid4().hex)
    try:
        staged.write_bytes(value)
        staged.replace(target)
        entry.size = len(value)
        entry.sha256 = hashlib.sha256(value).hexdigest()
        entry.updated_at = datetime.now(timezone.utc)
        if entry.space == "knowledge":
            await attach_document(db, user, entry)
        record(db, user, entry, "edit")
        await db.commit()
    except BaseException:
        target.write_bytes(original)
        raise
    finally:
        staged.unlink(missing_ok=True)


async def create_folder(db, user, space, parent, name, conflict="keep"):
    assert_write(space, user)
    clean_path(parent)
    name_only(name)
    directory = disk_path(space, parent)
    if not directory.is_dir():
        if parent:
            fail(404, "目标文件夹不存在")
        directory.mkdir(parents=True, exist_ok=True)
    if (directory / name).exists():
        if conflict == "skip":
            return None
        name = available_name(directory, name, True)
    path = "/".join(filter(None, [parent, name]))
    disk_path(space, path).mkdir()
    try:
        entry = await register(db, space, path, user)
        await db.flush()
        return entry
    except BaseException:
        disk_path(space, path).rmdir()
        raise


async def stage_upload(file: UploadFile, knowledge=False, db=None, purpose=None):
    name_only(file.filename or "")
    if knowledge and Path(file.filename).suffix.lower() not in (".md", ".markdown"):
        fail(400, "知识库仅支持 UTF-8 Markdown 文件")
    folder = Path(settings.storage_dir).resolve() / "temporary"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / uuid.uuid4().hex
    digest = hashlib.sha256()
    count = 0
    limit = (
        settings.max_file_size_mb if knowledge else settings.storage_max_file_mb
    ) * 1024**2
    if db is not None:
        from app.services.upload_service import file_limit

        limit = await file_limit(
            db, purpose or ("knowledge" if knowledge else "storage"), file.filename
        )
    limit = min(limit, 50 * 1024**2)
    try:
        async with aiofiles.open(target, "xb") as output:
            while chunk := await file.read(1024 * 1024):
                count += len(chunk)
                if count > limit:
                    fail(413, "文件超过上传大小上限")
                if (
                    shutil.disk_usage(folder).free - len(chunk)
                    < settings.storage_reserve_mb * 1024**2
                ):
                    fail(507, "服务器磁盘空间不足")
                await output.write(chunk)
                digest.update(chunk)
        if knowledge:
            try:
                target.read_text(encoding="utf-8-sig")
            except UnicodeError:
                fail(400, "Markdown 文件必须使用 UTF-8 编码")
        from app.services.storage_media import validate_image

        await asyncio.to_thread(validate_image, target, file.filename)
        return target, count, digest.hexdigest()
    except BaseException:
        target.unlink(missing_ok=True)
        raise


async def commit_upload(
    db, user, space, parent, name, staged, count, digest, conflict, internal=False
):
    if not internal:
        assert_write(space, user)
    clean_path(parent)
    name_only(name)
    directory = disk_path(space, parent)
    if not parent:
        directory.mkdir(parents=True, exist_ok=True)
    if not directory.is_dir():
        fail(404, "目标文件夹不存在")
    if (directory / name).exists():
        if conflict == "skip":
            return None
        name = available_name(directory, name)
    await check_quota(db, user, space, count, staged=True)
    path = "/".join(filter(None, [parent, name]))
    target = disk_path(space, path)
    staged.rename(target)
    try:
        entry = await register(db, space, path, user)
        entry.size, entry.sha256 = count, digest
        from app.services.storage_media import prepare_entry

        await asyncio.to_thread(prepare_entry, entry)
        if entry.thumbnail_size:
            info = await usage(db, user)
            if space != "knowledge" and (
                info["used_bytes"] + info["reserved_bytes"] > info["total_bytes"]
                or (
                    space == personal(user)
                    and info["personal_bytes"] + info["personal_reserved_bytes"]
                    > info["personal_limit"]
                )
            ):
                fail(413, "个人空间配额不足")
        if space == "knowledge":
            await attach_document(db, user, entry)
        await db.flush()
        return entry
    except BaseException:
        from app.services.storage_media import thumbnail_path

        if "entry" in locals():
            thumbnail_path(entry.id).unlink(missing_ok=True)
        target.rename(staged)
        raise


async def attach_document(db, user, entry):
    from app.models.document import Document, DocumentChunk, DocVisibility

    if entry.is_dir or Path(entry.path).suffix.lower() not in (".md", ".markdown"):
        return
    content = disk_path(entry.space, entry.path).read_text(encoding="utf-8-sig")
    doc = await db.get(Document, entry.document_id) if entry.document_id else None
    if not doc:
        doc = Document(
            id=uuid.uuid4(),
            title=Path(entry.path).stem,
            content=content,
            content_type="markdown",
            visibility=DocVisibility.public,
            is_published=True,
            author_id=user.id,
        )
        db.add(doc)
        await db.flush()
        entry.document_id = doc.id
    else:
        if doc.content != content:
            await db.execute(
                delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
            )
        doc.content = content
        doc.visibility = DocVisibility.public
        doc.is_published = True
    return doc


async def index_documents(db, ids):
    from app.models.document import Document
    from app.services.knowledge_service import _vectorize_document

    for doc_id in ids:
        doc = await db.get(Document, doc_id)
        if doc and doc.is_published:
            await _vectorize_document(doc, doc.content or "", db)


async def guard_upload_target(db, entry):
    if not entry.is_dir:
        return
    rows = (
        await db.scalars(
            select(UploadTask).where(
                UploadTask.space == entry.space,
                UploadTask.status == "active",
                UploadTask.expires_at > datetime.now(timezone.utc),
            )
        )
    ).all()
    for task in rows:
        parent = (
            f"DeviceLogs/{task.context['device_type']}"
            if task.purpose == "log"
            else task.parent
        )
        if parent == entry.path or parent.startswith(entry.path + "/"):
            fail(409, "文件夹存在上传任务，请完成或取消后再操作")


async def replace_copy(db, user, source_entry, destination):
    """Replace file contents while keeping the destination's identity and shares."""
    from app.services.storage_media import prepare_entry, thumbnail_path

    source = disk_path(source_entry.space, source_entry.path)
    target = disk_path(destination.space, destination.path)
    backup = target.with_name(".replace-" + uuid.uuid4().hex)
    staged = target.with_name(".copy-" + uuid.uuid4().hex)
    thumb = thumbnail_path(destination.id)
    old_thumb = thumb.read_bytes() if thumb.exists() else None
    delta = max(
        0,
        source.stat().st_size
        + source_entry.thumbnail_size
        - destination.size
        - destination.thumbnail_size,
    )
    await check_quota(db, user, destination.space, delta, staged=True)
    if (
        shutil.disk_usage(target.parent).free - source.stat().st_size - 512 * 1024
        < settings.storage_reserve_mb * 1024**2
    ):
        fail(507, "服务器可用磁盘空间不足")
    try:
        await asyncio.to_thread(shutil.copyfile, source, staged)
        target.rename(backup)
        staged.replace(target)
        destination.size = target.stat().st_size

        def digest_file():
            with target.open("rb") as source_file:
                return hashlib.file_digest(source_file, "sha256").hexdigest()

        destination.sha256 = await asyncio.to_thread(digest_file)
        await asyncio.to_thread(prepare_entry, destination)
        await db.flush()
        info = await usage(db, user)
        if destination.space != "knowledge" and (
            info["used_bytes"] + info["reserved_bytes"] > info["total_bytes"]
            or (
                destination.space == personal(user)
                and info["personal_bytes"] + info["personal_reserved_bytes"]
                > info["personal_limit"]
            )
        ):
            fail(413, "存储空间配额不足")
        destination.updated_at = datetime.now(timezone.utc)
        if destination.space == "knowledge":
            await attach_document(db, user, destination)
        record(db, user, destination, "replace", source_id=str(source_entry.id))
        await db.commit()
    except BaseException:
        if backup.exists():
            backup.replace(target)
        if old_thumb is None:
            thumb.unlink(missing_ok=True)
        else:
            thumb.write_bytes(old_thumb)
        raise
    finally:
        staged.unlink(missing_ok=True)
        backup.unlink(missing_ok=True)
    return destination


async def transfer(
    db, user, entry, destination_space, parent, copy=False, conflict="keep"
):
    await assert_read(db, entry, user)
    if entry.space.startswith(("ticket/", "draft/")):
        fail(403, "工单附件请在所属工单中管理")
    if not copy:
        assert_write(entry.space, user)
        await guard_upload_target(db, entry)
    assert_write(destination_space, user)
    clean_path(parent)
    if (
        not copy
        and entry.space == "public"
        and destination_space.startswith("personal/")
    ):
        fail(403, "公共文件只能复制到个人空间，不能移入")
    if entry.space != destination_space and "knowledge" in (
        entry.space,
        destination_space,
    ):
        fail(400, "知识库与存储空间之间请使用下载、上传迁移 Markdown 文件")
    if entry.space == destination_space and (
        parent == entry.path or parent.startswith(entry.path + "/")
    ):
        fail(400, "不能将文件夹放入自身或子文件夹")
    if (
        not copy
        and entry.space == destination_space
        and str(PurePosixPath(entry.path).parent) in (parent, parent or ".")
    ):
        return entry
    target_dir = disk_path(destination_space, parent)
    if not parent:
        target_dir.mkdir(parents=True, exist_ok=True)
    if not target_dir.is_dir():
        fail(404, "目标文件夹不存在")
    name = PurePosixPath(entry.path).name
    if (target_dir / name).exists():
        if conflict == "skip":
            return None
        if conflict == "replace":
            if not copy or entry.is_dir or not (target_dir / name).is_file():
                fail(400, "Replace is supported for copying files only")
            destination = await register(
                db, destination_space, "/".join(filter(None, [parent, name])), user
            )
            if destination.id == entry.id:
                fail(400, "Cannot replace a file with itself")
            return await replace_copy(db, user, entry, destination)
        name = available_name(target_dir, name, entry.is_dir)
    source = disk_path(entry.space, entry.path)
    amount = await asyncio.to_thread(tree_bytes, source)
    if destination_space == "knowledge":
        files = list(source.rglob("*")) if entry.is_dir else [source]
        for file in files:
            if file.is_file():
                if (
                    file.suffix.lower() not in (".md", ".markdown")
                    or file.stat().st_size > settings.max_file_size_mb * 1024**2
                ):
                    fail(400, "知识库仅支持 UTF-8 Markdown 文件")
                try:
                    file.read_text(encoding="utf-8-sig")
                except UnicodeError:
                    fail(400, "Markdown 文件必须使用 UTF-8 编码")
    await register_tree(db, entry.space, entry.path)
    children = await subtree(db, entry)
    amount += sum(child.thumbnail_size for child in children)
    await check_quota(
        db,
        user,
        destination_space,
        amount if copy or entry.space != destination_space else 0,
        pooled_delta=amount if copy else 0 if entry.space != "knowledge" else amount,
        staged=not copy,
    )
    new_path = "/".join(filter(None, [parent, name]))
    target = disk_path(destination_space, new_path)
    if copy:
        copied_thumbnails = []
        try:
            if entry.is_dir:
                await asyncio.to_thread(shutil.copytree, source, target, symlinks=False)
            else:
                await asyncio.to_thread(shutil.copyfile, source, target)
            result = None
            for child in sorted(children, key=lambda e: len(e.path)):
                rel = new_path + child.path[len(entry.path) :]
                new = await register(db, destination_space, rel, user)
                new.sha256 = child.sha256
                new.media_type = child.media_type
                if child.thumbnail_size:
                    from app.services.storage_media import thumbnail_path

                    original_thumb = thumbnail_path(child.id)
                    if original_thumb.is_file():
                        new_thumb = thumbnail_path(new.id)
                        new_thumb.parent.mkdir(parents=True, exist_ok=True)
                        await asyncio.to_thread(
                            shutil.copyfile, original_thumb, new_thumb
                        )
                        copied_thumbnails.append(new_thumb)
                        new.thumbnail_size = new_thumb.stat().st_size
                if destination_space == "knowledge":
                    await attach_document(db, user, new)
                record(db, user, new, "copy", source_id=str(child.id))
                if child.id == entry.id:
                    result = new
            return result
        except BaseException:
            for thumb in copied_thumbnails:
                thumb.unlink(missing_ok=True)
            if target.exists():
                shutil.rmtree(target) if target.is_dir() else target.unlink(
                    missing_ok=True
                )
            raise
    source.rename(target)
    old_path, old_space = entry.path, entry.space
    try:
        for child in children:
            child.path = new_path + child.path[len(old_path) :]
            child.space = destination_space
            child.updated_at = datetime.now(timezone.utc)
            record(db, user, child, "move", from_path=old_path, from_space=old_space)
            if old_space != destination_space:
                await db.execute(
                    delete(StorageShare).where(StorageShare.entry_id == child.id)
                )
                if destination_space == "knowledge":
                    await attach_document(db, user, child)
                elif old_space == "knowledge" and child.document_id:
                    from app.models.document import Document

                    doc = await db.get(Document, child.document_id)
                    child.document_id = None
                    await db.flush()
                    if doc:
                        await db.delete(doc)
        await db.flush()
    except BaseException:
        target.rename(source)
        raise
    return entry


async def rename(db, user, entry, name):
    assert_write(entry.space, user)
    await guard_upload_target(db, entry)
    name_only(name)
    if (
        entry.space == "knowledge"
        and not entry.is_dir
        and Path(name).suffix.lower() not in (".md", ".markdown")
    ):
        fail(400, "知识库文件必须保留 Markdown 扩展名")
    parent = str(PurePosixPath(entry.path).parent)
    parent = "" if parent == "." else parent
    path = "/".join(filter(None, [parent, name]))
    if path == entry.path:
        return
    target = disk_path(entry.space, path)
    if target.exists():
        fail(409, "名称已存在，请使用不同名称")
    await register_tree(db, entry.space, entry.path)
    children = await subtree(db, entry)
    disk_path(entry.space, entry.path).rename(target)
    old = entry.path
    for child in children:
        child.path = path + child.path[len(old) :]
        child.updated_at = datetime.now(timezone.utc)
        record(db, user, child, "rename", from_path=old)


async def delete_entry(db, user, entry):
    assert_write(entry.space, user)
    await guard_upload_target(db, entry)
    await register_tree(db, entry.space, entry.path)
    children = await subtree(db, entry)
    if entry.space == "public":
        target = disk_path(entry.space, entry.path, entry.id)
        target.parent.mkdir(parents=True, exist_ok=True)
        disk_path(entry.space, entry.path).rename(target)
        for child in children:
            child.trash_id = entry.id
            child.deleted_at = datetime.now(timezone.utc)
            record(db, user, child, "trash")
            await db.execute(
                delete(StorageShare).where(StorageShare.entry_id == child.id)
            )
    else:
        from app.services.storage_maintenance import drain_garbage, queue_entries

        await queue_entries(db, user, children, "delete")
        await db.commit()
        await drain_garbage(db)


async def remove_records(db, user, children, action):
    from app.models.document import Document
    from app.models.preset import UploadedLog

    for child in sorted(children, key=lambda e: -len(e.path)):
        if (
            not child.space.startswith("draft/")
            and action != "delete_ticket_attachments"
        ):
            record(
                db,
                user,
                child,
                action,
                ticket_id=str(child.ticket_id) if child.ticket_id else None,
                name=PurePosixPath(child.path).name,
                size=child.size,
            )
        await db.execute(
            delete(UploadedLog).where(UploadedLog.storage_entry_id == child.id)
        )
        if child.document_id:
            doc = await db.get(Document, child.document_id)
            if doc:
                await db.delete(doc)
        await db.delete(child)


async def recycle(db, user, entry_id, purge=False):
    if user.role != UserRole.developer:
        fail(403, "仅开发者可以恢复或清空公共回收站")
    root = await db.get(StorageEntry, entry_id)
    if not root or root.space != "public" or root.trash_id != root.id:
        fail(404, "回收站记录不存在")
    children = await subtree(db, root)
    source = disk_path("public", root.path, root.id)
    if purge:
        from app.services.storage_maintenance import drain_garbage, queue_entries

        await queue_entries(db, user, children, "purge")
        await db.commit()
        await drain_garbage(db)
        return
    parent = PurePosixPath(root.path).parent
    parent_path = "" if str(parent) == "." else str(parent)
    # Like Explorer restore, recreate missing original parents.
    directory = disk_path("public", parent_path)
    for component in [directory, *directory.parents]:
        if component.exists() and not component.is_dir():
            fail(409, "目标文件夹不存在")
    directory.mkdir(parents=True, exist_ok=True)
    for i in range(1, len(parent.parts) + 1):
        rel = PurePosixPath(*parent.parts[:i]).as_posix()
        if rel != ".":
            await register(db, "public", rel, user)
    name = available_name(directory, PurePosixPath(root.path).name, root.is_dir)
    path = "/".join(filter(None, [parent_path, name]))
    source.rename(disk_path("public", path))
    old = root.path
    for child in children:
        child.path = path + child.path[len(old) :]
        child.trash_id = None
        child.deleted_at = None
        record(db, user, child, "restore", from_path=old)
    shutil.rmtree(
        Path(settings.storage_dir).resolve() / "recycle" / str(root.id),
        ignore_errors=True,
    )


def mime_type(path):
    ext = Path(path).suffix.lower()
    if ext in (
        ".md",
        ".markdown",
        ".txt",
        ".log",
        ".csv",
        ".json",
        ".sh",
        ".xml",
        ".yaml",
        ".yml",
    ):
        return "text/plain; charset=utf-8"
    return mimetypes.guess_type(path)[0] or "application/octet-stream"
