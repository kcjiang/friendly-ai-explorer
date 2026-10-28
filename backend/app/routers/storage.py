import hashlib
import io
import uuid
from pathlib import Path, PurePosixPath
from typing import Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Query,
    Request,
    UploadFile,
)
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.middleware.rbac import AnyUser, DevOnly
from app.models.document import Document
from app.models.storage import FileOperation, StorageEntry, StorageShare
from app.models.user import User
from app.services import storage_service as s

router = APIRouter()


async def run_index(ids):
    async with AsyncSessionLocal() as db:
        await s.index_documents(db, ids)


def queue_index(tasks, entries):
    ids = [e.document_id for e in entries if e.document_id]
    if ids:
        tasks.add_task(run_index, ids)


def space_key(space, user):
    if space == "personal":
        return s.personal(user)
    if space in ("public", "knowledge"):
        return space
    s.fail(400, "无效空间")


class FolderRequest(BaseModel):
    space: Literal["public", "personal", "knowledge"]
    parent: str = ""
    name: str
    conflict: Literal["skip", "keep"] = "keep"


class MarkdownRequest(FolderRequest):
    content: str = Field(default="", max_length=2_000_000)


class RenameRequest(BaseModel):
    name: str


class TransferRequest(BaseModel):
    space: Literal["public", "personal", "knowledge"]
    parent: str = ""
    copy_file: bool = Field(default=False, alias="copy")
    conflict: Literal["skip", "keep"] = "keep"


class ContentRequest(BaseModel):
    content: str = Field(max_length=2_000_000)


class ShareRequest(BaseModel):
    user_ids: list[uuid.UUID] = Field(max_length=100)


class CapacityRequest(BaseModel):
    total_bytes: int = Field(ge=0, le=1024**5)
    default_personal_bytes: int = Field(ge=0, le=1024**5)
    user_quotas: dict[str, int] = Field(default_factory=dict, max_length=10000)
    upload_limits: dict[str, int] = Field(default_factory=dict)


@router.get("/usage")
async def usage(user: AnyUser, db: AsyncSession = Depends(get_db)):
    result = await s.usage(db, user)
    await db.commit()
    return result


@router.get("/capacity")
async def capacity(user: DevOnly, db: AsyncSession = Depends(get_db)):
    config = await s.get_settings(db)
    result = {
        "total_bytes": config.total_bytes,
        "default_personal_bytes": config.default_personal_bytes,
        "user_quotas": config.user_quotas,
        "upload_limits": config.upload_limits or {},
    }
    await db.commit()
    return result


@router.put("/capacity")
async def set_capacity(
    body: CapacityRequest, user: DevOnly, db: AsyncSession = Depends(get_db)
):
    quotas = {}
    for key, value in body.user_quotas.items():
        try:
            key = str(uuid.UUID(key))
        except ValueError:
            s.fail(400, "无效用户")
        if isinstance(value, bool) or value < 0 or value > 1024**5:
            s.fail(400, "无效个人配额")
        if not await db.get(User, uuid.UUID(key)):
            s.fail(400, "用户不存在")
        quotas[key] = value
    await s.lock(db)
    config = await s.get_settings(db)
    config.total_bytes = body.total_bytes
    config.default_personal_bytes = body.default_personal_bytes
    config.user_quotas = quotas
    from app.services.upload_service import DEFAULT_LIMITS

    if any(
        k not in DEFAULT_LIMITS or isinstance(v, bool) or v < 1 or v > 2048
        for k, v in body.upload_limits.items()
    ):
        s.fail(400, "无效上传大小限制")
    config.upload_limits = dict(body.upload_limits)
    db.add(
        FileOperation(
            actor_id=user.id,
            space="public",
            path="",
            action="capacity",
            details=body.model_dump(),
        )
    )
    await db.commit()
    return {"ok": True}


@router.get("/entries")
async def entries(
    user: AnyUser,
    space: Literal["public", "personal", "knowledge"] = "public",
    path: str = "",
    shared_id: uuid.UUID | None = None,
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    await s.lock(db)
    from app.services.storage_listing import page as list_page

    result = await list_page(
        db, user, space_key(space, user), path, shared_id, q, page, page_size
    )
    await db.commit()
    return result


@router.get("/exists")
async def exists(
    user: AnyUser,
    space: Literal["public", "personal", "knowledge"],
    name: str,
    parent: str = "",
):
    key = space_key(space, user)
    s.name_only(name)
    s.clean_path(parent)
    path = "/".join(filter(None, [parent, name]))
    return {"exists": s.disk_path(key, path).exists()}


@router.post("/folders", status_code=201)
async def folder(
    body: FolderRequest, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    await s.lock(db)
    entry = await s.create_folder(
        db, user, space_key(body.space, user), body.parent, body.name, body.conflict
    )
    result = await s.serialize(db, entry) if entry else {"skipped": True}
    await db.commit()
    return result


@router.get("/ticket-archive")
async def ticket_archive(
    user: AnyUser,
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ticket_attachments import archive

    return await archive(db, user, q, page, page_size)


async def save_upload(file, space, parent, conflict, user, db, tasks):
    staged, count, digest = await s.stage_upload(file, space == "knowledge", db=db)
    target = None
    try:
        await s.lock(db)
        entry = await s.commit_upload(
            db, user, space, parent, file.filename, staged, count, digest, conflict
        )
        if entry:
            target = s.disk_path(entry.space, entry.path)
        result = await s.serialize(db, entry) if entry else {"skipped": True}
        await db.commit()
    except BaseException:
        if target and target.exists():
            target.unlink()
        raise
    finally:
        staged.unlink(missing_ok=True)
    if entry:
        queue_index(tasks, [entry])
    return result


@router.post("/upload", status_code=201)
async def upload(
    tasks: BackgroundTasks,
    user: AnyUser,
    file: UploadFile = File(...),
    space: Literal["public", "personal", "knowledge"] = Form("personal"),
    parent: str = Form(""),
    conflict: Literal["skip", "keep"] = Form("skip"),
    db: AsyncSession = Depends(get_db),
):
    return await save_upload(
        file, space_key(space, user), parent, conflict, user, db, tasks
    )


@router.post("/markdown", status_code=201)
async def markdown(
    body: MarkdownRequest,
    tasks: BackgroundTasks,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    name = (
        body.name
        if body.name.lower().endswith((".md", ".markdown"))
        else body.name + ".md"
    )
    file = UploadFile(filename=name, file=io.BytesIO(body.content.encode("utf-8")))
    return await save_upload(
        file, space_key(body.space, user), body.parent, body.conflict, user, db, tasks
    )


@router.get("/shared")
async def shared(user: AnyUser, db: AsyncSession = Depends(get_db)):
    rows = (
        await db.scalars(
            select(StorageEntry)
            .join(StorageShare, StorageShare.entry_id == StorageEntry.id)
            .where(StorageShare.user_id == user.id, StorageEntry.trash_id.is_(None))
        )
    ).all()
    return [
        await s.serialize(db, e) for e in rows if s.disk_path(e.space, e.path).exists()
    ]


@router.get("/trash")
async def trash(user: AnyUser, db: AsyncSession = Depends(get_db)):
    rows = (
        await db.scalars(
            select(StorageEntry)
            .where(
                StorageEntry.space == "public", StorageEntry.trash_id == StorageEntry.id
            )
            .order_by(StorageEntry.deleted_at.desc())
        )
    ).all()
    return [await s.serialize(db, e) for e in rows]


@router.delete("/trash")
async def empty_trash(user: DevOnly, db: AsyncSession = Depends(get_db)):
    ids = (
        await db.scalars(
            select(StorageEntry.id).where(
                StorageEntry.space == "public", StorageEntry.trash_id == StorageEntry.id
            )
        )
    ).all()
    removed = 0
    for entry_id in ids:
        await s.lock(db)
        root = await db.get(StorageEntry, entry_id, populate_existing=True)
        if root and root.trash_id == root.id:
            await s.recycle(db, user, entry_id, purge=True)
            removed += 1
    await db.commit()
    return {"removed": removed}


@router.post("/trash/{entry_id}/restore")
async def restore(
    entry_id: uuid.UUID, user: DevOnly, db: AsyncSession = Depends(get_db)
):
    await s.lock(db)
    root = await db.get(StorageEntry, entry_id)
    original = s.disk_path("public", root.path, entry_id) if root else None
    try:
        await s.recycle(db, user, entry_id)
        destination = s.disk_path("public", root.path)
        await db.commit()
    except BaseException:
        if (
            original
            and "destination" in locals()
            and destination.exists()
            and not original.exists()
        ):
            original.parent.mkdir(parents=True, exist_ok=True)
            destination.rename(original)
        raise
    return {"ok": True}


@router.delete("/trash/{entry_id}")
async def purge(entry_id: uuid.UUID, user: DevOnly, db: AsyncSession = Depends(get_db)):
    await s.lock(db)
    await s.recycle(db, user, entry_id, purge=True)
    return {"ok": True}


@router.post("/knowledge/sync")
async def sync_knowledge(
    tasks: BackgroundTasks, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    await s.lock(db)
    root = s.space_root("knowledge")
    root.mkdir(parents=True, exist_ok=True)
    indexed, errors = [], []
    rows = (
        await db.scalars(select(StorageEntry).where(StorageEntry.space == "knowledge"))
    ).all()
    for entry in rows:
        if not s.disk_path(entry.space, entry.path).exists():
            await s.remove_records(db, user, [entry], "external_deleted")
    await db.flush()
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            continue
        rel = path.relative_to(root).as_posix()
        try:
            entry = await s.register(db, "knowledge", rel)
            if not entry.is_dir and path.suffix.lower() in (".md", ".markdown"):
                if path.stat().st_size > settings_limit():
                    errors.append(rel + ": 文件过大")
                    continue
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                needs_index = False
                if entry.document_id:
                    from app.services.knowledge_service import _index_states

                    doc = await db.get(Document, entry.document_id)
                    if doc:
                        await _index_states([doc], db)
                        needs_index = doc.index_status in ("pending", "text_only")
                if digest != entry.sha256 or not entry.document_id or needs_index:
                    await s.attach_document(db, user, entry)
                    entry.sha256, entry.size = digest, path.stat().st_size
                    s.record(db, None, entry, "external_edit")
                    indexed.append(entry)
        except UnicodeError:
            errors.append(rel + ": 非 UTF-8 文本")
    await db.commit()
    queue_index(tasks, indexed)
    return {"indexed": len(indexed), "errors": errors}


def settings_limit():
    from app.config import settings

    return settings.max_file_size_mb * 1024**2


@router.api_route("/{entry_id}/download", methods=["GET", "HEAD"])
async def download(
    entry_id: uuid.UUID,
    request: Request,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    entry = await s.entry_for(db, entry_id, user)
    if entry.is_dir:
        s.fail(400, "请打开文件夹选择文件下载")
    from app.file_response import download_response

    return download_response(
        request,
        s.disk_path(entry.space, entry.path),
        PurePosixPath(entry.path).name,
        entry.media_type or s.mime_type(entry.path),
    )


@router.get("/{entry_id}/content")
async def content(
    entry_id: uuid.UUID, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    entry = await s.entry_for(db, entry_id, user)
    path = s.disk_path(entry.space, entry.path)
    if entry.is_dir or not s.mime_type(entry.path).startswith("text/"):
        s.fail(415, "此格式请下载后查看")
    if path.stat().st_size > 2_000_000:
        s.fail(413, "文件较大，请下载后查看")
    return {"content": path.read_text(encoding="utf-8-sig", errors="replace")}


@router.api_route("/{entry_id}/thumbnail", methods=["GET", "HEAD"])
async def thumbnail(
    entry_id: uuid.UUID,
    request: Request,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    entry = await s.entry_for(db, entry_id, user)
    from app.file_response import download_response
    from app.services.storage_media import thumbnail_path

    path = thumbnail_path(entry.id)
    if not entry.thumbnail_size or not path.is_file():
        s.fail(404, "文件不存在")
    return download_response(request, path, "thumbnail.webp", "image/webp")


@router.put("/{entry_id}/content")
async def edit(
    entry_id: uuid.UUID,
    body: ContentRequest,
    tasks: BackgroundTasks,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    await s.lock(db)
    entry = await s.entry_for(db, entry_id, user, write=True)
    if entry.is_dir or Path(entry.path).suffix.lower() not in (".md", ".markdown"):
        s.fail(400, "目前仅支持编辑 Markdown")
    target = s.disk_path(entry.space, entry.path)
    original = target.read_bytes()
    value = body.content.encode("utf-8")
    await s.check_quota(db, user, entry.space, max(0, len(value) - len(original)))
    try:
        target.write_bytes(value)
        entry.size = len(value)
        entry.sha256 = hashlib.sha256(value).hexdigest()
        from datetime import datetime, timezone

        entry.updated_at = datetime.now(timezone.utc)
        if entry.space == "knowledge":
            await s.attach_document(db, user, entry)
        s.record(db, user, entry, "edit")
        await db.commit()
    except BaseException:
        target.write_bytes(original)
        raise
    queue_index(tasks, [entry])
    return {"ok": True}


@router.patch("/{entry_id}")
async def rename(
    entry_id: uuid.UUID,
    body: RenameRequest,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    await s.lock(db)
    entry = await s.entry_for(db, entry_id, user, write=True)
    old = s.disk_path(entry.space, entry.path)
    try:
        await s.rename(db, user, entry, body.name)
        new = s.disk_path(entry.space, entry.path)
        await db.commit()
    except BaseException:
        if "new" in locals() and new != old and new.exists():
            new.rename(old)
        raise
    return {"ok": True}


@router.post("/{entry_id}/transfer")
async def transfer(
    entry_id: uuid.UUID,
    body: TransferRequest,
    tasks: BackgroundTasks,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    await s.lock(db)
    entry = await s.entry_for(db, entry_id, user)
    old = s.disk_path(entry.space, entry.path)
    try:
        result = await s.transfer(
            db,
            user,
            entry,
            space_key(body.space, user),
            body.parent,
            body.copy_file,
            body.conflict,
        )
        target = s.disk_path(result.space, result.path) if result else None
        index = (
            await s.subtree(db, result)
            if result and result.space == "knowledge"
            else []
        )
        await db.commit()
    except BaseException:
        if "target" in locals() and target and target != old and target.exists():
            if body.copy_file:
                shutil_remove(target)
            else:
                target.rename(old)
        raise
    queue_index(tasks, index)
    return {"ok": True, "skipped": result is None}


def shutil_remove(path):
    import shutil

    shutil.rmtree(path) if path.is_dir() else path.unlink(missing_ok=True)


@router.delete("/{entry_id}")
async def remove(
    entry_id: uuid.UUID, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    await s.lock(db)
    entry = await s.entry_for(db, entry_id, user, write=True)
    source = s.disk_path(entry.space, entry.path)
    try:
        await s.delete_entry(db, user, entry)
        await db.commit()
    except BaseException:
        if entry.space == "public":
            target = s.disk_path(entry.space, entry.path, entry.id)
            if target.exists() and not source.exists():
                target.rename(source)
        raise
    return {"ok": True}


@router.get("/{entry_id}/shares")
async def get_shares(
    entry_id: uuid.UUID, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    entry = await s.entry_for(db, entry_id, user, write=True)
    if entry.space != s.personal(user):
        s.fail(400, "仅个人空间需要共享授权")
    return [
        str(i)
        for i in (
            await db.scalars(
                select(StorageShare.user_id).where(StorageShare.entry_id == entry.id)
            )
        ).all()
    ]


@router.put("/{entry_id}/shares")
async def share(
    entry_id: uuid.UUID,
    body: ShareRequest,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    await s.lock(db)
    entry = await s.entry_for(db, entry_id, user, write=True)
    if entry.space != s.personal(user):
        s.fail(400, "仅个人空间需要共享授权")
    ids = set(body.user_ids) - {user.id}
    valid = (
        await db.scalars(
            select(User.id).where(User.id.in_(ids), User.is_active.is_(True))
        )
    ).all()
    if len(valid) != len(ids):
        s.fail(400, "部分用户不存在或已停用")
    await db.execute(delete(StorageShare).where(StorageShare.entry_id == entry.id))
    db.add_all([StorageShare(entry_id=entry.id, user_id=i) for i in ids])
    s.record(db, user, entry, "share", user_ids=[str(i) for i in ids])
    await db.commit()
    return {"ok": True}


@router.get("/{entry_id}/operations")
async def operations(
    entry_id: uuid.UUID, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    entry = await db.get(StorageEntry, entry_id)
    if not (entry and entry.space == "public" and entry.trash_id):
        entry = await s.entry_for(db, entry_id, user)
    rows = (
        await db.execute(
            select(FileOperation, User.name)
            .outerjoin(User, FileOperation.actor_id == User.id)
            .where(FileOperation.entry_id == entry.id)
            .order_by(FileOperation.created_at.desc())
            .limit(100)
        )
    ).all()
    return [
        {
            "id": str(o.id),
            "actor": name,
            "action": o.action,
            "path": o.path,
            "details": o.details,
            "created_at": o.created_at,
        }
        for o, name in rows
    ]
