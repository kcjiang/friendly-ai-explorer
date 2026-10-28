from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.i18n import message as system_message
from app.middleware.rbac import AnyUser
from app.schemas.preset import (
    CreatePresetRequest,
    PresetCommandOut,
    UpdatePresetRequest,
)
from app.services import preset_service

router = APIRouter()


# ── 预制命令 ──────────────────────────────────────────────────


@router.get(
    "/commands", response_model=list[PresetCommandOut], summary="获取预制命令列表"
)
async def list_presets(
    device_type: str,  # query param: adb | serial
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.list_presets(device_type, db, current_user)


@router.post(
    "/commands",
    response_model=PresetCommandOut,
    status_code=201,
    summary="新建预制命令",
)
async def create_preset(
    body: CreatePresetRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.create_preset(body, db, current_user)


@router.patch(
    "/commands/{preset_id}", response_model=PresetCommandOut, summary="更新预制命令"
)
async def update_preset(
    preset_id: str,
    body: UpdatePresetRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.update_preset(preset_id, body, db, current_user)


@router.delete("/commands/{preset_id}", summary="删除预制命令")
async def delete_preset(
    preset_id: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.delete_preset(preset_id, db, current_user)


# ── 日志上传 / 列表 / 下载 / 删除 ────────────────────────────


@router.post("/logs", status_code=201, summary="上传日志文件")
async def upload_log(
    current_user: AnyUser,
    file: UploadFile = File(...),
    device_type: str = Form(...),
    description: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.upload_log(
        file, device_type, description, db, current_user
    )


@router.get("/logs", summary="获取日志列表")
async def list_logs(
    device_type: str,
    current_user: AnyUser,
    page: int | None = Query(None, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    q: str = Query("", max_length=100),
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.list_logs(
        device_type, db, current_user, page, page_size, q
    )


@router.get("/logs/{log_id}/download", summary="下载日志文件")
async def download_log(
    log_id: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    from sqlalchemy import select

    from app.models.preset import UploadedLog

    result = await db.execute(select(UploadedLog).where(UploadedLog.id == log_id))
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(
            status_code=404, detail=system_message("errors.logNotFound")
        )
    if log.user_id != current_user.id:
        raise HTTPException(
            status_code=403, detail=system_message("errors.accessDenied")
        )
    from app.services import storage_service as storage

    if not log.storage_entry_id:
        storage.fail(404, "日志尚未迁移到个人空间")
    entry = await storage.entry_for(db, log.storage_entry_id, current_user)
    path = storage.disk_path(entry.space, entry.path)
    if not path.exists():
        raise HTTPException(
            status_code=404, detail=system_message("errors.fileNotFound")
        )
    return FileResponse(
        path,
        filename=Path(entry.path).name,
        media_type="text/plain",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/logs/{log_id}", summary="删除日志记录")
async def delete_log(
    log_id: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.delete_log(log_id, db, current_user)
