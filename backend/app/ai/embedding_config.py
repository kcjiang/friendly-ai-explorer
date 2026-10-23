"""Persisted embedding configuration, independent of chat routes and API keys."""

from dataclasses import dataclass
from hashlib import sha256
import json

from sqlalchemy import Integer
from sqlalchemy import String, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
import uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, AsyncSessionLocal


class EmbeddingSettings(Base):
    __tablename__ = "embedding_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    active_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("embedding_profiles.id"), nullable=True
    )


class EmbeddingProfile(Base):
    __tablename__ = "embedding_profiles"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100))
    config: Mapped[dict] = mapped_column(JSONB, default=dict)


@dataclass(frozen=True)
class EmbeddingConfig:
    vendor: str = "other"
    protocol: str = "disabled"
    base_url: str = ""
    model: str = ""
    api_key_encrypted: str | None = None
    timeout_seconds: int = 16
    send_dimensions: bool = False
    query_prefix: str = ""
    document_prefix: str = ""
    min_similarity: float = 0.65

    @property
    def identity(self):
        values = [
            self.protocol,
            self.base_url,
            self.model,
            768,
            self.query_prefix,
            self.document_prefix,
        ]
        return (
            "embedding:"
            + sha256(json.dumps(values, ensure_ascii=False).encode()).hexdigest()
        )


def default_embedding_config():
    return EmbeddingConfig()


async def load_embedding_config(db=None):
    if db is None:
        async with AsyncSessionLocal() as session:
            return await load_embedding_config(session)
    row = await db.get(EmbeddingSettings, 1)
    if row and row.active_profile_id:
        profile = await db.get(EmbeddingProfile, row.active_profile_id)
        if not profile:
            return default_embedding_config()
        return EmbeddingConfig(**profile.config)
    return default_embedding_config()
