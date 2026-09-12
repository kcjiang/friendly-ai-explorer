from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser
from app.schemas.preset import (
    PresetCommandOut, CreatePresetRequest, UpdatePresetRequest
)
from app.services import preset_service

router = APIRouter()


# ── 预制命令 ──────────────────────────────────────────────────

@router.get("/commands", response_model=list[PresetCommandOut], summary="获取预制命令列表")
async def list_presets(
    device_type: str,          # query param: adb | serial
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.list_presets(device_type, db, current_user)


@router.post("/commands", response_model=PresetCommandOut, status_code=201, summary="新建预制命令")
async def create_preset(
    body: CreatePresetRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.create_preset(body, db, current_user)


@router.patch("/commands/{preset_id}", response_model=PresetCommandOut, summary="更新预制命令")
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
    file:        UploadFile = File(...),
    device_type: str        = Form(...),
    description: str        = Form(""),
    db: AsyncSession        = Depends(get_db),
):
    return await preset_service.upload_log(file, device_type, description, db, current_user)


@router.get("/logs", summary="获取日志列表")
async def list_logs(
    device_type: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.list_logs(device_type, db, current_user)


@router.get("/logs/{log_id}/download", summary="下载日志文件")
async def download_log(
    log_id: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    from app.models.preset import UploadedLog
    from app.models.user import UserRole
    from fastapi import HTTPException

    result = await db.execute(select(UploadedLog).where(UploadedLog.id == log_id))
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="日志不存在")
    if log.user_id != current_user.id and current_user.role != UserRole.developer:
        raise HTTPException(status_code=403, detail="无权访问")
    if not Path(log.file_path).exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(log.file_path, filename=log.filename, media_type="text/plain")


@router.delete("/logs/{log_id}", summary="删除日志记录")
async def delete_log(
    log_id: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await preset_service.delete_log(log_id, db, current_user)
