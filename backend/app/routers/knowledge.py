from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser
from app.schemas.document import (
    CreateDocumentRequest,
    DocumentListOut,
    DocumentOut,
    UpdateDocumentRequest,
)
from app.services import knowledge_service

router = APIRouter()


@router.get("/{doc_id}/download")
async def download_original(
    doc_id: UUID, current_user: AnyUser, db: AsyncSession = Depends(get_db)
):
    from pathlib import Path

    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    from app.config import settings
    from app.models.document import Document

    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404)
    root = Path(settings.storage_dir) / "knowledge-originals"
    files = list(root.glob(str(doc.id) + ".*"))
    if not files:
        raise HTTPException(404)
    return FileResponse(
        files[0],
        filename=doc.file_original_name or files[0].name,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("", response_model=list[DocumentListOut], include_in_schema=False)
@router.get("/", response_model=list[DocumentListOut], summary="文档列表")
async def list_documents(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await knowledge_service.list_documents(db, current_user)


@router.post("", response_model=DocumentOut, status_code=201, include_in_schema=False)
@router.post(
    "/", response_model=DocumentOut, status_code=201, summary="新建 Markdown 文档"
)
async def create_document(
    body: CreateDocumentRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_service.create_document(body, db, current_user)


@router.post(
    "/upload",
    response_model=DocumentOut,
    status_code=201,
    summary="上传文件（PDF/DOCX/图片）",
)
async def upload_document(
    current_user: AnyUser,
    file: UploadFile = File(...),
    title: str = Form(""),
    visibility: str = Form("public"),
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_service.upload_document(
        file, title, visibility, db, current_user
    )


@router.get("/{doc_id}", response_model=DocumentOut, summary="文档详情")
async def get_document(
    doc_id: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_service.get_document(doc_id, db, current_user)


@router.post("/{doc_id}/reindex", summary="重建已发布文档索引（仅作者）")
async def reindex_document(
    doc_id: UUID, current_user: AnyUser, db: AsyncSession = Depends(get_db)
):
    return await knowledge_service.reindex_document(doc_id, db, current_user)


@router.patch("/{doc_id}", response_model=DocumentOut, summary="修改文档（仅作者）")
async def update_document(
    doc_id: str,
    body: UpdateDocumentRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_service.update_document(doc_id, body, db, current_user)


@router.delete("/{doc_id}", summary="删除文档（仅开发者）")
async def delete_document(
    doc_id: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_service.delete_document(doc_id, db, current_user)
