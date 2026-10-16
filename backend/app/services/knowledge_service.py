import os
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

import aiofiles
from fastapi import HTTPException, UploadFile
from sqlalchemy import select, delete, func, case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.document import Document, DocumentChunk, DocVisibility
from app.models.user import User, UserRole
from app.schemas.document import CreateDocumentRequest, UpdateDocumentRequest
from app.ai.file_parser import parse_file
from app.ai.embeddings import chunk_text, embed_chunks, embedding_identity, EmbeddingUnavailable
from app.ai.embedding_config import load_embedding_config

logger = logging.getLogger(__name__)


# ── 可见性过滤 ────────────────────────────────────────────────

def _visibility_filter(user: User):
    """非作者只能看到公开文档；作者可以看到自己的所有文档"""
    from sqlalchemy import or_
    return or_(
        Document.visibility == DocVisibility.public,
        Document.author_id == user.id,
    )


# ── 向量化入库（内部使用）────────────────────────────────────

async def _vectorize_document(doc: Document, text: str, db: AsyncSession):
    """Always keep searchable text, even if the external embedding service fails."""
    doc_id, title = doc.id, doc.title
    config = await load_embedding_config(db)
    chunks = chunk_text(text)
    embeddings, error = [None] * len(chunks), None
    if chunks and config.protocol != "disabled":
        try:
            vectors = await asyncio.wait_for(embed_chunks([f"{title}\n{chunk}" for chunk in chunks], config=config), timeout=45)
            if len(vectors) != len(chunks):
                raise EmbeddingUnavailable("batch_size_mismatch")
            embeddings = vectors
        except Exception as exc:
            error = exc.reason if isinstance(exc, EmbeddingUnavailable) else "embedding_failed"
            logger.warning("知识库向量化失败，已保留文本索引供关键词检索", exc_info=True,
                           extra={"details": {"document_id": str(doc_id), "embedding_model": embedding_identity(config), "reason": error}})
    current = await db.scalar(select(Document).where(Document.id == doc_id).with_for_update().execution_options(populate_existing=True))
    if not current or current.content != text or current.title != title or not current.is_published:
        await db.commit()  # release the lock; a newer edit owns its own indexing operation
        return
    await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))
    for i, (content, emb) in enumerate(zip(chunks, embeddings)):
        db.add(DocumentChunk(
            document_id=doc_id,
            chunk_index=i,
            content=content,
            embedding=emb,
            metadata_={"embedding_model": embedding_identity(config) if emb is not None else None, "embedding_error": error},
        ))

    await db.commit()
    logger.info("知识库索引更新完成", extra={"details": {"document_id": str(doc_id), "chunks": len(chunks), "vectors": sum(v is not None for v in embeddings), "embedding_model": embedding_identity(config)}})


async def _index_states(docs, db):
    if not docs:
        return docs
    config = await load_embedding_config(db)
    counts = (await db.execute(select(DocumentChunk.document_id, func.count().label("chunks"),
        func.sum(case(((DocumentChunk.embedding.is_not(None)) & (DocumentChunk.metadata_["embedding_model"].astext == embedding_identity(config)), 1), else_=0)).label("vectors"))
        .where(DocumentChunk.document_id.in_([d.id for d in docs])).group_by(DocumentChunk.document_id))).all()
    stats = {row.document_id: row for row in counts}
    for doc in docs:
        row = stats.get(doc.id)
        doc.indexed_chunks = row.chunks if row else 0
        doc.indexed_vectors = int(row.vectors or 0) if row else 0
        doc.index_model = embedding_identity(config)
        doc.index_status = "draft" if not doc.is_published else "empty" if not (doc.content or "").strip() else "pending" if not row else "ready" if doc.indexed_vectors == doc.indexed_chunks else "text_only"
    return docs


# ── CRUD ─────────────────────────────────────────────────────

async def list_documents(db: AsyncSession, user: User) -> list[Document]:
    result = await db.execute(
        select(Document)
        .options(selectinload(Document.author))
        .where(_visibility_filter(user))
        .order_by(Document.updated_at.desc())
    )
    return await _index_states(list(result.scalars().all()), db)


async def get_document(doc_id: str, db: AsyncSession, user: User) -> Document:
    result = await db.execute(
        select(Document)
        .options(selectinload(Document.author))
        .where(Document.id == doc_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    # 私有文档只有作者可以访问
    if doc.visibility == DocVisibility.private and doc.author_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此文档")
    # 增加浏览量
    doc.view_count += 1
    await db.commit()
    return (await _index_states([doc], db))[0]


async def create_document(body: CreateDocumentRequest, db: AsyncSession, user: User) -> Document:
    doc = Document(
        author_id=user.id,
        title=body.title,
        content=body.content,
        content_type="markdown",
        visibility=body.visibility,
        is_published=body.is_published,
        tags=body.tags,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # 自动向量化
    if body.content and body.is_published:
        await _vectorize_document(doc, body.content, db)

    result = await db.execute(
        select(Document).options(selectinload(Document.author)).where(Document.id == doc.id)
    )
    return (await _index_states([result.scalar_one()], db))[0]


async def update_document(
    doc_id: str, body: UpdateDocumentRequest, db: AsyncSession, user: User
) -> Document:
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.author_id != user.id:
        raise HTTPException(status_code=403, detail="只有作者可以修改文档")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(doc, k, v)
    doc.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # 内容或发布状态有变化时重新向量化
    if (body.content is not None or body.is_published is not None or body.title is not None) and doc.is_published:
        text = body.content if body.content is not None else doc.content
        await _vectorize_document(doc, text or "", db)
    elif not doc.is_published:
        await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc.id))
        await db.commit()

    result = await db.execute(
        select(Document).options(selectinload(Document.author)).where(Document.id == doc_id)
    )
    return (await _index_states([result.scalar_one()], db))[0]


async def delete_document(doc_id: str, db: AsyncSession, user: User) -> dict:
    """仅开发者可删除（路由层已做角色校验）"""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")

    # 删除关联文件
    if doc.file_url:
        file_path = Path(settings.upload_dir) / doc.file_url.lstrip("/uploads/")
        if file_path.exists():
            file_path.unlink(missing_ok=True)

    await db.delete(doc)
    await db.commit()
    return {"message": "删除成功"}


async def upload_document(
    file: UploadFile, title: str, visibility: str, db: AsyncSession, user: User
) -> Document:
    """上传文件并自动解析 + 向量化"""
    allowed = {".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".webp"}
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式：{ext}")

    # 保存文件
    save_dir = Path(settings.upload_dir)
    save_dir.mkdir(parents=True, exist_ok=True)
    unique_name = f"{uuid.uuid4()}{ext}"
    save_path   = save_dir / unique_name

    file_bytes = await file.read()
    if len(file_bytes) > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="文件大小超出限制")

    async with aiofiles.open(save_path, "wb") as f:
        await f.write(file_bytes)

    # 解析文本
    extracted_text = parse_file(file_bytes, file.filename or unique_name)

    # 判断 content_type
    if ext == ".pdf":
        ctype = "pdf"
    elif ext in (".docx", ".doc"):
        ctype = "docx"
    else:
        ctype = "image"

    doc = Document(
        author_id=user.id,
        title=title or file.filename,
        content=extracted_text,
        content_type=ctype,
        file_url=f"/uploads/{unique_name}",
        file_original_name=file.filename,
        visibility=DocVisibility(visibility),
        is_published=True,
        tags=None,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # 自动向量化
    if extracted_text.strip():
        await _vectorize_document(doc, extracted_text, db)

    result = await db.execute(
        select(Document).options(selectinload(Document.author)).where(Document.id == doc.id)
    )
    return (await _index_states([result.scalar_one()], db))[0]


async def reindex_document(doc_id: str, db: AsyncSession, user: User):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "文档不存在")
    if doc.author_id != user.id:
        raise HTTPException(403, "只有作者可以重建文档索引")
    if not doc.is_published:
        raise HTTPException(409, "请先发布文档，再重建索引")
    await _vectorize_document(doc, doc.content or "", db)
    await _index_states([doc], db)
    return {"document_id": str(doc.id), "index_status": doc.index_status, "indexed_chunks": doc.indexed_chunks,
            "indexed_vectors": doc.indexed_vectors, "index_model": doc.index_model}
