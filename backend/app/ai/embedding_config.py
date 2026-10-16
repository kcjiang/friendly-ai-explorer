"""Persisted embedding configuration, independent of chat routes and API keys."""
from dataclasses import dataclass
from hashlib import sha256
import json

from sqlalchemy import Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base, AsyncSessionLocal


class EmbeddingSettings(Base):
    __tablename__ = "embedding_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)


@dataclass(frozen=True)
class EmbeddingConfig:
    protocol: str = "gemini"
    base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    model: str = "gemini-embedding-001"
    api_key_encrypted: str | None = None
    use_env_key: bool = True
    timeout_seconds: int = 16
    send_dimensions: bool = False
    query_prefix: str = ""
    document_prefix: str = ""
    min_similarity: float = 0.65

    @property
    def identity(self):
        # Retain compatibility with existing default Gemini vectors.
        if self.protocol == "gemini" and self.base_url == EmbeddingConfig.base_url and not self.query_prefix and not self.document_prefix:
            return f"models/{self.model.removeprefix('models/')}:768"
        values = [self.protocol, self.base_url, self.model, 768, self.query_prefix, self.document_prefix]
        return "embedding:" + sha256(json.dumps(values, ensure_ascii=False).encode()).hexdigest()


def environment_config():
    return EmbeddingConfig(model=settings.embedding_model)


async def load_embedding_config(db=None):
    if db is None:
        async with AsyncSessionLocal() as session:
            return await load_embedding_config(session)
    row = await db.get(EmbeddingSettings, 1)
    return EmbeddingConfig(**row.config) if row and row.config else environment_config()
