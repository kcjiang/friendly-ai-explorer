"""Workbench configuration and bounded message/job state."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def now():
    return datetime.now(timezone.utc)


class WBPreference(Base):
    __tablename__ = "workbench_preferences"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    schedule: Mapped[dict] = mapped_column(JSONB)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_automation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class WBCheck(Base):
    __tablename__ = "workbench_checks"
    __table_args__ = (
        CheckConstraint("origin IN ('manual', 'scheduled')"),
        CheckConstraint("status IN ('queued', 'running', 'completed', 'failed')"),
        Index(
            "ix_workbench_checks_pending",
            "id",
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
        Index("ix_workbench_checks_finished", "finished_at"),
        Index("ix_workbench_checks_user", "user_id", "id"),
        Index(
            "uq_workbench_checks_active",
            "user_id",
            "origin",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    origin: Mapped[str] = mapped_column(String(16))
    output_locale: Mapped[str] = mapped_column(
        String(35), default="en", server_default="en"
    )
    status: Mapped[str] = mapped_column(String(16), default="queued")
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(1000))


class WBAccount(Base):
    __tablename__ = "workbench_accounts"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(150))
    platform: Mapped[str] = mapped_column(String(20))
    base_url: Mapped[str] = mapped_column(String(500))
    username: Mapped[str] = mapped_column(String(255))
    password_encrypted: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="idle")
    error: Mapped[str | None] = mapped_column(Text)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    mail_folder_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WBAutomation(Base):
    __tablename__ = "workbench_automations"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(150))
    kind: Mapped[str] = mapped_column(String(20), default="custom")
    position: Mapped[int] = mapped_column(Integer, default=0)
    steps: Mapped[list] = mapped_column(JSONB)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WBMessage(Base):
    __tablename__ = "workbench_messages"
    __table_args__ = (
        Index(
            "workbench_messages_source",
            "account_id",
            "source_key",
            unique=True,
            postgresql_where=text("source_key IS NOT NULL"),
        ),
        Index(
            "ix_workbench_messages_account_received", "account_id", "received_at", "id"
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_accounts.id", ondelete="CASCADE"), index=True
    )
    payload: Mapped[dict] = mapped_column(JSONB)
    note: Mapped[str] = mapped_column(Text, default="")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    submitted: Mapped[bool] = mapped_column(Boolean, default=False)
    dismissed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    source_key: Mapped[str | None] = mapped_column(String(300))
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    resource_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    resource_source: Mapped[dict | None] = mapped_column(JSONB)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class WBJob(Base):
    __tablename__ = "workbench_jobs"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    automation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_automations.id", ondelete="RESTRICT"), index=True
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workbench_messages.id", ondelete="CASCADE"), index=True
    )
    input_revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    snapshot: Mapped[dict] = mapped_column(JSONB)
    steps: Mapped[list] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    step_index: Mapped[int] = mapped_column(Integer, default=0)
    logs: Mapped[list] = mapped_column(JSONB, default=list)
    error: Mapped[str | None] = mapped_column(Text)
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tickets.id", ondelete="SET NULL")
    )
    queued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class WBDebugEvent(Base):
    __tablename__ = "workbench_debug_events"
    __table_args__ = (Index("ix_workbench_debug_events_user_cursor", "user_id", "id"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    output: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
