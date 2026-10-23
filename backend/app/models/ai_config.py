import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AIProvider(Base):
    __tablename__ = "ai_providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    vendor: Mapped[str] = mapped_column(String(30), default="other")
    auth_required: Mapped[bool] = mapped_column(Boolean, default=True)
    token_parameter: Mapped[str] = mapped_column(String(30), default="max_tokens")
    capability_checks: Mapped[dict] = mapped_column(JSONB, default=dict)
    protocol: Mapped[str] = mapped_column(String(30))
    base_url: Mapped[str] = mapped_column(String(1000))
    model: Mapped[str] = mapped_column(String(200))
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=90)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=2048)
    max_concurrency: Mapped[int] = mapped_column(Integer, default=1)
    thinking_mode: Mapped[str] = mapped_column(String(10), default="auto")
    structured_output: Mapped[str] = mapped_column(String(10), default="auto")
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=1)
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_test_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AIRoute(Base):
    __tablename__ = "ai_routes"

    task: Mapped[str] = mapped_column(String(40), primary_key=True)
    provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("ai_providers.id"), nullable=True)
    fallback_provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("ai_providers.id"), nullable=True)
    timeout_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)


class AICallLog(Base):
    __tablename__ = "ai_call_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task: Mapped[str] = mapped_column(String(40))
    provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("ai_providers.id", ondelete="SET NULL"), nullable=True)
    provider_name: Mapped[str] = mapped_column(String(100))
    model: Mapped[str] = mapped_column(String(200))
    success: Mapped[bool] = mapped_column(Boolean)
    fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    diagnostics: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
