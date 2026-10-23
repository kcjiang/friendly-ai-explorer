import logging
import time
from fastapi import HTTPException
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)
from typing import Literal
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from app.ai.embedding_config import (
    EmbeddingSettings,
    EmbeddingProfile,
    EmbeddingConfig,
    load_embedding_config,
)
from app.ai.embeddings import embed_text, EmbeddingUnavailable
from app.ai.provider_client import encrypt_key
from app.models.document import Document, DocumentChunk
from app.schemas.ai_config import ProviderInput


class EmbeddingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vendor: Literal["openai", "gemini", "deepseek", "qwen", "other"] = "other"
    protocol: Literal["gemini", "openai", "disabled"]
    base_url: str = Field(default="", max_length=1000)
    model: str = Field(default="", max_length=200, pattern=r"^[a-zA-Z0-9_.:/-]*$")
    api_key: SecretStr | None = None
    clear_api_key: bool = False
    timeout_seconds: int = Field(default=16, ge=5, le=30)
    send_dimensions: bool = False
    query_prefix: str = Field(default="", max_length=300)
    document_prefix: str = Field(default="", max_length=300)
    min_similarity: float = Field(default=0.65, ge=0, le=1, allow_inf_nan=False)

    @field_validator("base_url")
    @classmethod
    def url(cls, value):
        return ProviderInput.valid_url(value.strip()) if value.strip() else ""

    @model_validator(mode="after")
    def configured_endpoint(self):
        if self.protocol != "disabled" and (not self.base_url or not self.model):
            raise ValueError("请填写向量服务地址和模型名称")
        return self


class ProfileInput(EmbeddingInput):
    name: str = Field(min_length=1, max_length=100)
    protocol: Literal["gemini", "openai"]

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value):
        if not value.strip():
            raise ValueError("请输入服务名称")
        return value.strip()


class ActiveProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: UUID | None = None


async def lock_settings(db):
    await db.execute(insert(EmbeddingSettings).values(id=1).on_conflict_do_nothing())
    return await db.scalar(
        select(EmbeddingSettings).where(EmbeddingSettings.id == 1).with_for_update()
    )


def profile_public(row):
    config = EmbeddingConfig(**row.config)
    return {
        "id": row.id,
        "name": row.name,
        **{k: v for k, v in vars(config).items() if k != "api_key_encrypted"},
        "has_api_key": bool(config.api_key_encrypted),
    }


async def get_profile(db, profile_id):
    row = await db.get(EmbeddingProfile, profile_id)
    if not row:
        raise HTTPException(404, "向量服务不存在")
    return row


async def list_profiles(db):
    rows = (
        await db.scalars(
            select(EmbeddingProfile).order_by(
                EmbeddingProfile.name, EmbeddingProfile.id
            )
        )
    ).all()
    return [profile_public(row) for row in rows]


def encrypted_config(body, old):
    key = body.api_key.get_secret_value().strip() if body.api_key else ""
    changed_endpoint = (old.protocol, old.base_url) != (body.protocol, body.base_url)
    encrypted = (
        encrypt_key(key)
        if key
        else None
        if body.clear_api_key or changed_endpoint
        else old.api_key_encrypted
    )
    if body.protocol == "gemini" and not encrypted:
        raise HTTPException(422, "请在管理页面填写 Gemini 向量服务的 API Key")
    return {
        **body.model_dump(exclude={"name", "api_key", "clear_api_key"}),
        "api_key_encrypted": encrypted,
    }


async def save_profile(db, body, profile_id=None):
    await lock_settings(db)
    if profile_id:
        row = await get_profile(db, profile_id)
    else:
        if await db.scalar(select(func.count()).select_from(EmbeddingProfile)) >= 50:
            raise HTTPException(422, "最多保存 50 个向量服务")
        row = EmbeddingProfile(config={})
    row.config = encrypted_config(body, EmbeddingConfig(**row.config))
    row.name = body.name
    db.add(row)
    await db.commit()
    return profile_public(row)


async def activate_profile(db, profile_id):
    settings = await lock_settings(db)
    if profile_id:
        await get_profile(db, profile_id)
    settings.active_profile_id = profile_id
    await db.commit()
    return await public_config(db)


async def delete_profile(db, profile_id):
    settings = await lock_settings(db)
    row = await get_profile(db, profile_id)
    if settings.active_profile_id == profile_id:
        raise HTTPException(409, "请先切换到其他向量服务或仅关键词检索，再删除当前服务")
    await db.delete(row)
    await db.commit()
    return {"message": "已删除向量服务"}


async def public_config(db):
    config = await load_embedding_config(db)
    settings = await db.get(EmbeddingSettings, 1)
    data = {
        key: value for key, value in vars(config).items() if key != "api_key_encrypted"
    }
    total = await db.scalar(
        select(func.count())
        .select_from(Document)
        .where(
            Document.is_published.is_(True),
            func.length(func.trim(Document.content)) > 0,
        )
    )
    # Only documents whose every chunk uses the selected encoder count as ready.
    incomplete = select(DocumentChunk.document_id).where(
        DocumentChunk.embedding.is_(None)
        | (
            DocumentChunk.metadata_["embedding_model"].astext.is_distinct_from(
                config.identity
            )
        )
    )
    complete = await db.scalar(
        select(func.count(func.distinct(DocumentChunk.document_id)))
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(
            Document.is_published.is_(True),
            DocumentChunk.embedding.is_not(None),
            ~DocumentChunk.document_id.in_(incomplete),
            DocumentChunk.metadata_["embedding_model"].astext == config.identity,
        )
    )
    return {
        **data,
        "active_profile_id": settings.active_profile_id if settings else None,
        "has_api_key": bool(config.api_key_encrypted),
        "dimensions": 768,
        "identity": config.identity,
        "published_documents": total,
        "indexed_documents": complete,
        "reindex_required": config.protocol != "disabled" and complete < total,
    }


async def test_config(db, profile_id=None):
    config = (
        EmbeddingConfig(**(await get_profile(db, profile_id)).config)
        if profile_id
        else await load_embedding_config(db)
    )
    await db.rollback()
    if config.protocol == "disabled":
        return {
            "success": False,
            "message": "当前仅使用关键词检索，未启用向量服务",
            "elapsed_ms": 0,
        }
    started = time.monotonic()
    try:
        # Validate query and document paths, including prefixes, dimensions and finite values.
        for task in ("retrieval_query", "retrieval_document"):
            await embed_text("知识库连接测试", task_type=task, config=config)
        ok, message = True, "连接成功，查询和文档向量均为有效的 768 维向量"
    except EmbeddingUnavailable as exc:
        ok, message = False, "向量服务测试失败：" + exc.reason
    elapsed = round((time.monotonic() - started) * 1000)
    logging.getLogger(__name__).log(
        logging.INFO if ok else logging.WARNING,
        message,
        extra={"details": {"elapsed_ms": elapsed, "embedding_model": config.identity}},
    )
    return {"success": ok, "message": message, "elapsed_ms": elapsed}
