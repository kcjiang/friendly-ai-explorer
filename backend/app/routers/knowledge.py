from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.rbac import AnyUser, DevOnly
from app.schemas.document import (
    CreateDocumentRequest, UpdateDocumentRequest,
    DocumentListOut, DocumentOut,
)
from app.services import knowledge_service

router = APIRouter()


@router.get("/", response_model=list[DocumentListOut], summary="文档列表")
async def list_documents(current_user: AnyUser, db: AsyncSession = Depends(get_db)):
    return await knowledge_service.list_documents(db, current_user)


@router.post("/", response_model=DocumentOut, status_code=201, summary="新建 Markdown 文档")
async def create_document(
    body: CreateDocumentRequest,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_service.create_document(body, db, current_user)


@router.post("/upload", response_model=DocumentOut, status_code=201, summary="上传文件（PDF/DOCX/图片）")
async def upload_document(
    current_user: AnyUser,
    file:       UploadFile = File(...),
    title:      str        = Form(""),
    visibility: str        = Form("public"),
    db: AsyncSession       = Depends(get_db),
):
    return await knowledge_service.upload_document(file, title, visibility, db, current_user)


@router.get("/{doc_id}", response_model=DocumentOut, summary="文档详情")
async def get_document(
    doc_id: str,
    current_user: AnyUser,
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_service.get_document(doc_id, db, current_user)


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
    current_user: DevOnly,
    db: AsyncSession = Depends(get_db),
):
    return await knowledge_service.delete_document(doc_id, db, current_user)
