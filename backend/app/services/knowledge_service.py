import asyncio
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.embedding_config import load_embedding_config
from app.ai.embeddings import (
    EmbeddingUnavailable,
    chunk_text,
    embed_chunks,
    embedding_identity,
)
from app.i18n import message as system_message
from app.models.document import Document, DocumentChunk, DocVisibility
from app.models.user import User
from app.schemas.document import CreateDocumentRequest, UpdateDocumentRequest

logger = logging.getLogger(__name__)


# ── 可见性过滤 ────────────────────────────────────────────────


def _visibility_filter(user: User):
    """Knowledge is shared by all signed-in users."""
    from sqlalchemy import true

    return true()


async def _save_markdown_file(doc, db, user):
    import hashlib
    import re
    import uuid
    from pathlib import Path

    from app.models.storage import StorageEntry
    from app.services import storage_service as storage

    await storage.lock(db)
    entry = await db.scalar(
        select(StorageEntry).where(StorageEntry.document_id == doc.id)
    )
    value = (doc.content or "").encode("utf-8")
    await storage.check_quota(db, user, "knowledge", len(value))
    if not entry:
        root = storage.disk_path("knowledge")
        root.mkdir(parents=True, exist_ok=True)
        name = (
            re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", doc.title).strip(" .") or "Untitled"
        )
        name = name.encode("utf-8")[:180].decode("utf-8", errors="ignore")
        if not name.lower().endswith((".md", ".markdown")):
            name += ".md"
        name = storage.available_name(root, name)
        target = storage.disk_path("knowledge", name)
    else:
        target = storage.disk_path(entry.space, entry.path)
    previous = target.read_bytes() if target.exists() else None
    temporary = Path(storage.settings.storage_dir) / "temporary" / uuid.uuid4().hex
    temporary.parent.mkdir(parents=True, exist_ok=True)
    try:
        temporary.write_bytes(value)
        temporary.replace(target)
        if not entry:
            entry = await storage.register(db, "knowledge", name, user)
            entry.document_id = doc.id
        else:
            storage.record(db, user, entry, "edit")
        entry.sha256 = hashlib.sha256(value).hexdigest()
        entry.size = len(value)
        entry.updated_at = datetime.now(timezone.utc)
        await db.execute(
            delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
        )
        await db.commit()
    except BaseException:
        if previous is None:
            target.unlink(missing_ok=True)
        else:
            target.write_bytes(previous)
        raise
    finally:
        temporary.unlink(missing_ok=True)


# ── 向量化入库（内部使用）────────────────────────────────────


async def _vectorize_document(doc: Document, text: str, db: AsyncSession):
    """Always keep searchable text, even if the external embedding service fails."""
    doc_id, title = doc.id, doc.title
    config = await load_embedding_config(db)
    chunks = chunk_text(text)
    embeddings, error = [None] * len(chunks), None
    if chunks and config.protocol != "disabled":
        try:
            vectors = await asyncio.wait_for(
                embed_chunks([f"{title}\n{chunk}" for chunk in chunks], config=config),
                timeout=45,
            )
            if len(vectors) != len(chunks):
                raise EmbeddingUnavailable("batch_size_mismatch")
            embeddings = vectors
        except Exception as exc:
            error = (
                exc.reason
                if isinstance(exc, EmbeddingUnavailable)
                else "embedding_failed"
            )
            logger.warning(
                "知识库向量化失败，已保留文本索引供关键词检索",
                exc_info=True,
                extra={
                    "details": {
                        "document_id": str(doc_id),
                        "embedding_model": embedding_identity(config),
                        "reason": error,
                    }
                },
            )
    current = await db.scalar(
        select(Document)
        .where(Document.id == doc_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        not current
        or current.content != text
        or current.title != title
        or not current.is_published
    ):
        await (
            db.commit()
        )  # release the lock; a newer edit owns its own indexing operation
        return
    await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))
    for i, (content, emb) in enumerate(zip(chunks, embeddings)):
        db.add(
            DocumentChunk(
                document_id=doc_id,
                chunk_index=i,
                content=content,
                embedding=emb,
                metadata_={
                    "embedding_model": embedding_identity(config)
                    if emb is not None
                    else None,
                    "embedding_error": error,
                },
            )
        )

    await db.commit()
    logger.info(
        "知识库索引更新完成",
        extra={
            "details": {
                "document_id": str(doc_id),
                "chunks": len(chunks),
                "vectors": sum(v is not None for v in embeddings),
                "embedding_model": embedding_identity(config),
            }
        },
    )


async def _index_states(docs, db):
    if not docs:
        return docs
    config = await load_embedding_config(db)
    counts = (
        await db.execute(
            select(
                DocumentChunk.document_id,
                func.count().label("chunks"),
                func.sum(
                    case(
                        (
                            (DocumentChunk.embedding.is_not(None))
                            & (
                                DocumentChunk.metadata_["embedding_model"].astext
                                == embedding_identity(config)
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("vectors"),
            )
            .where(DocumentChunk.document_id.in_([d.id for d in docs]))
            .group_by(DocumentChunk.document_id)
        )
    ).all()
    stats = {row.document_id: row for row in counts}
    for doc in docs:
        row = stats.get(doc.id)
        doc.indexed_chunks = row.chunks if row else 0
        doc.indexed_vectors = int(row.vectors or 0) if row else 0
        doc.index_model = embedding_identity(config)
        doc.index_status = (
            "draft"
            if not doc.is_published
            else "empty"
            if not (doc.content or "").strip()
            else "pending"
            if not row
            else "ready"
            if doc.indexed_vectors == doc.indexed_chunks
            else "text_only"
        )
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
        raise HTTPException(
            status_code=404, detail=system_message("errors.documentNotFound")
        )
    # 增加浏览量
    doc.view_count += 1
    await db.commit()
    return (await _index_states([doc], db))[0]


async def create_document(
    body: CreateDocumentRequest, db: AsyncSession, user: User
) -> Document:
    doc = Document(
        author_id=user.id,
        title=body.title,
        content=body.content,
        content_type="markdown",
        visibility=DocVisibility.public,
        is_published=True,
        tags=body.tags,
    )
    db.add(doc)
    await db.flush()
    await _save_markdown_file(doc, db, user)
    await db.refresh(doc)

    # 自动向量化
    if body.content:
        await _vectorize_document(doc, body.content, db)

    result = await db.execute(
        select(Document)
        .options(selectinload(Document.author))
        .where(Document.id == doc.id)
    )
    return (await _index_states([result.scalar_one()], db))[0]


async def update_document(
    doc_id: str, body: UpdateDocumentRequest, db: AsyncSession, user: User
) -> Document:
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(
            status_code=404, detail=system_message("errors.documentNotFound")
        )
    for k, v in body.model_dump(exclude_unset=True).items():
        if k in ("visibility", "is_published"):
            continue
        setattr(doc, k, v)
    doc.visibility = DocVisibility.public
    doc.is_published = True
    doc.updated_at = datetime.now(timezone.utc)
    await _save_markdown_file(doc, db, user)

    # 内容或发布状态有变化时重新向量化
    if (
        body.content is not None
        or body.is_published is not None
        or body.title is not None
    ) and doc.is_published:
        text = body.content if body.content is not None else doc.content
        await _vectorize_document(doc, text or "", db)
    elif not doc.is_published:
        await db.execute(
            delete(DocumentChunk).where(DocumentChunk.document_id == doc.id)
        )
        await db.commit()

    result = await db.execute(
        select(Document)
        .options(selectinload(Document.author))
        .where(Document.id == doc_id)
    )
    return (await _index_states([result.scalar_one()], db))[0]


async def delete_document(doc_id: str, db: AsyncSession, user: User) -> dict:
    """仅开发者可删除（路由层已做角色校验）"""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(
            status_code=404, detail=system_message("errors.documentNotFound")
        )

    from app.models.storage import StorageEntry
    from app.services import storage_service as storage

    await storage.lock(db)
    entry = await db.scalar(
        select(StorageEntry).where(StorageEntry.document_id == doc.id)
    )
    if entry:
        await storage.delete_entry(db, user, entry)
    else:
        await db.delete(doc)
        await db.commit()
    return {"message": system_message("errors.deleteSuccess")}


async def upload_document(
    file: UploadFile, title: str, visibility: str, db: AsyncSession, user: User
) -> Document:
    """Legacy endpoint, using the same private streaming storage as the browser."""
    from app.services import storage_service as storage

    staged, count, digest = await storage.stage_upload(file, knowledge=True, db=db)
    target = None
    try:
        await storage.lock(db)
        entry = await storage.commit_upload(
            db, user, "knowledge", "", file.filename, staged, count, digest, "keep"
        )
        target = storage.disk_path(entry.space, entry.path)
        doc = await db.get(Document, entry.document_id)
        if title:
            doc.title = title[:500]
        doc.file_original_name = file.filename
        await db.commit()
    except BaseException:
        if target:
            target.unlink(missing_ok=True)
        raise
    finally:
        staged.unlink(missing_ok=True)
    await _vectorize_document(doc, doc.content or "", db)

    result = await db.execute(
        select(Document)
        .options(selectinload(Document.author))
        .where(Document.id == doc.id)
    )
    return (await _index_states([result.scalar_one()], db))[0]


async def reindex_document(doc_id: str, db: AsyncSession, user: User):
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, system_message("errors.documentNotFound"))
    if not doc.is_published:
        raise HTTPException(
            409, system_message("errors.publishTheDocumentBeforeRebuildingItsIndex")
        )
    await _vectorize_document(doc, doc.content or "", db)
    await _index_states([doc], db)
    return {
        "document_id": str(doc.id),
        "index_status": doc.index_status,
        "indexed_chunks": doc.indexed_chunks,
        "indexed_vectors": doc.indexed_vectors,
        "index_model": doc.index_model,
    }
