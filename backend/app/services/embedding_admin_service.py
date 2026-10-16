import logging
import time
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from typing import Literal
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from app.ai.embedding_config import EmbeddingSettings, EmbeddingConfig, load_embedding_config
from app.ai.embeddings import embed_text, EmbeddingUnavailable
from app.ai.provider_client import encrypt_key
from app.config import settings
from app.models.document import Document, DocumentChunk
from app.schemas.ai_config import ProviderInput


class EmbeddingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol: Literal["gemini", "openai", "disabled"]
    base_url: str = Field(min_length=1, max_length=1000)
    model: str = Field(min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_.:/-]+$")
    api_key: SecretStr | None = None
    clear_api_key: bool = False
    use_env_key: bool = False
    timeout_seconds: int = Field(default=16, ge=5, le=30)
    send_dimensions: bool = False
    query_prefix: str = Field(default="", max_length=300)
    document_prefix: str = Field(default="", max_length=300)
    min_similarity: float = Field(default=0.65, ge=0, le=1, allow_inf_nan=False)

    @field_validator("base_url")
    @classmethod
    def url(cls, value):
        return ProviderInput.valid_url(value.strip())

    @model_validator(mode="after")
    def environment_key(self):
        if self.use_env_key and self.protocol != "gemini":
            raise ValueError("只有 Gemini 接口可引用 GOOGLE_API_KEY")
        if self.use_env_key and self.api_key and self.api_key.get_secret_value().strip():
            raise ValueError("请选择环境密钥或独立密钥，不要同时填写")
        return self


async def public_config(db):
    config = await load_embedding_config(db)
    data = {key: value for key, value in vars(config).items() if key != "api_key_encrypted"}
    total = await db.scalar(select(func.count()).select_from(Document).where(Document.is_published.is_(True), func.length(func.trim(Document.content)) > 0))
    # Only documents whose every chunk uses the selected encoder count as ready.
    incomplete = select(DocumentChunk.document_id).where(DocumentChunk.embedding.is_(None) | (DocumentChunk.metadata_["embedding_model"].astext.is_distinct_from(config.identity)))
    complete = await db.scalar(select(func.count(func.distinct(DocumentChunk.document_id))).join(Document, Document.id == DocumentChunk.document_id)
        .where(Document.is_published.is_(True), DocumentChunk.embedding.is_not(None), ~DocumentChunk.document_id.in_(incomplete), DocumentChunk.metadata_["embedding_model"].astext == config.identity))
    return {**data, "has_api_key": bool(config.api_key_encrypted or config.use_env_key and settings.google_api_key),
        "dimensions": 768, "identity": config.identity, "published_documents": total, "indexed_documents": complete,
        "reindex_required": config.protocol != "disabled" and complete < total}


async def save_config(db, body):
    # Lock the singleton, including when initialized by a first-time installation.
    await db.execute(insert(EmbeddingSettings).values(id=1, config={}).on_conflict_do_nothing())
    row = await db.scalar(select(EmbeddingSettings).where(EmbeddingSettings.id == 1).with_for_update())
    old = EmbeddingConfig(**row.config) if row.config else await load_embedding_config(db)
    key = body.api_key.get_secret_value().strip() if body.api_key else ""
    changed_endpoint = (old.protocol, old.base_url) != (body.protocol, body.base_url)
    encrypted = None if body.use_env_key else encrypt_key(key) if key else None if body.clear_api_key or changed_endpoint else old.api_key_encrypted
    if body.protocol == "gemini" and not encrypted and not (body.use_env_key and settings.google_api_key):
        raise HTTPException(422, "Gemini 向量服务需要密钥或有效的环境变量密钥")
    row.config = {**body.model_dump(exclude={"api_key", "clear_api_key"}), "api_key_encrypted": encrypted}
    await db.commit()
    logging.getLogger(__name__).info("知识库向量服务配置已更新", extra={"details": {"protocol": body.protocol, "model": body.model}})
    return await public_config(db)


async def test_config(db):
    config = await load_embedding_config(db)
    await db.rollback()
    if config.protocol == "disabled":
        return {"success": False, "message": "当前仅使用关键词检索，未启用向量服务", "elapsed_ms": 0}
    started = time.monotonic()
    try:
        # Validate query and document paths, including prefixes, dimensions and finite values.
        for task in ("retrieval_query", "retrieval_document"):
            await embed_text("知识库连接测试", task_type=task, config=config)
        ok, message = True, "连接成功，查询和文档向量均为有效的 768 维向量"
    except EmbeddingUnavailable as exc:
        ok, message = False, "向量服务测试失败：" + exc.reason
    elapsed = round((time.monotonic() - started) * 1000)
    logging.getLogger(__name__).log(logging.INFO if ok else logging.WARNING, message, extra={"details": {"elapsed_ms": elapsed, "embedding_model": config.identity}})
    return {"success": ok, "message": message, "elapsed_ms": elapsed}
