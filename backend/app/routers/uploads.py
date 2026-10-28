import asyncio
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser, DevOnly
from app.models.storage import StorageEntry, UploadTask
from app.services import storage_service as s
from app.services import upload_service as u

router = APIRouter()


class BeginUpload(BaseModel):
    description: str = Field(default="", max_length=500)
    upload_id: uuid.UUID | None = None
    filename: str
    size: int = Field(ge=0, le=2**53)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    purpose: Literal["storage", "knowledge", "log", "attachment"] = "storage"
    space: Literal["public", "personal"] = "personal"
    parent: str = ""
    conflict: Literal["skip", "keep"] = "skip"
    ticket_id: uuid.UUID | None = None
    device_type: Literal["adb", "serial"] | None = None


@router.get("/policy")
async def policy(user: AnyUser, db: AsyncSession = Depends(get_db)):
    limits = await u.policy(db)
    await db.commit()
    return {
        "limits_mb": limits,
        "chunk_size": u.CHUNK_SIZE,
        "threshold": u.THRESHOLD,
        "expires_hours": 48,
        "image_max_pixels": 40_000_000,
        "image_max_dimension": 16384,
    }


@router.get("")
async def tasks(user: AnyUser, db: AsyncSession = Depends(get_db)):
    rows = (
        await db.scalars(
            select(UploadTask)
            .where(
                UploadTask.user_id == user.id,
                UploadTask.expires_at > datetime.now(timezone.utc),
            )
            .order_by(UploadTask.created_at.desc())
            .limit(200)
        )
    ).all()
    return [u.describe(t) for t in rows]


@router.post("", status_code=201)
async def begin(body: BeginUpload, user: AnyUser, db: AsyncSession = Depends(get_db)):
    return u.describe(await u.create(db, user, body))


@router.get("/{task_id}")
async def get(task_id: uuid.UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    task = await u.owned(db, user, task_id)
    return u.describe(task)


@router.put("/{task_id}/parts/{index}")
async def part(
    task_id: uuid.UUID,
    index: int,
    request: Request,
    user: AnyUser,
    sha256: str = Query(pattern=r"^[0-9a-f]{64}$"),
    db: AsyncSession = Depends(get_db),
):
    if index < 0:
        s.fail(400, "无效路径")
    return u.describe(await u.write_part(db, user, task_id, index, sha256, request))


@router.post("/{task_id}/complete")
async def complete(
    task_id: uuid.UUID,
    tasks: BackgroundTasks,
    user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    task = await u.finish(db, user, task_id)
    if task.entry_id:
        entry = await db.get(StorageEntry, task.entry_id)
        if entry and entry.document_id:
            from app.routers.storage import run_index

            tasks.add_task(run_index, [entry.document_id])
    return u.describe(task)


@router.delete("/{task_id}")
async def cancel(task_id: uuid.UUID, user: AnyUser, db: AsyncSession = Depends(get_db)):
    return u.describe(await u.cancel(db, user, task_id))


class CopyUpload(BaseModel):
    entry_id: uuid.UUID
    ticket_id: uuid.UUID | None = None


@router.post("/from-entry", status_code=201)
async def copy_entry(
    body: CopyUpload, user: AnyUser, db: AsyncSession = Depends(get_db)
):
    entry = await s.entry_for(db, body.entry_id, user)
    if entry.space != s.personal(user) or entry.trash_id:
        s.fail(403, "无权操作此空间")
    if entry.is_dir:
        s.fail(400, "请打开文件夹选择文件下载")
    source = s.disk_path(entry.space, entry.path)
    request = BeginUpload(
        filename=source.name,
        size=source.stat().st_size,
        fingerprint=hashlib.sha256(str(uuid.uuid4()).encode()).hexdigest(),
        purpose="attachment",
        ticket_id=body.ticket_id,
        conflict="keep",
    )
    task = await u.create(db, user, request)

    class BytesRequest:
        def __init__(self, value):
            self.value = value

        async def stream(self):
            yield self.value

    try:
        with source.open("rb") as file:
            index = 0
            while value := await asyncio.to_thread(file.read, task.chunk_size):
                task = await u.write_part(
                    db,
                    user,
                    task.id,
                    index,
                    hashlib.sha256(value).hexdigest(),
                    BytesRequest(value),
                )
                index += 1
        return u.describe(await u.finish(db, user, task.id))
    except BaseException:
        await db.rollback()
        await u.cancel(db, user, task.id)
        raise


@router.post("/maintenance/run")
async def maintenance(user: DevOnly, db: AsyncSession = Depends(get_db)):
    from app.services.storage_maintenance import reconcile, sweep

    removed = await sweep(db)
    return {"removed": removed, **await reconcile(db)}
