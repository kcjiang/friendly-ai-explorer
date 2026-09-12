import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, BigInteger, Integer
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class PresetCommand(Base):
    __tablename__ = "preset_commands"

    id:          Mapped[uuid.UUID]     = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name:        Mapped[str]           = mapped_column(String(200), nullable=False)
    command:     Mapped[str]           = mapped_column(Text, nullable=False)
    group_name:  Mapped[str]           = mapped_column(String(100), default="通用")
    device_type: Mapped[str]           = mapped_column(String(20), nullable=False)  # adb | serial
    is_public:   Mapped[bool]          = mapped_column(Boolean, default=False)
    is_danger:   Mapped[bool]          = mapped_column(Boolean, default=False)
    owner_id:    Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    created_at:  Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at:  Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class UploadedLog(Base):
    __tablename__ = "uploaded_logs"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id:     Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_type: Mapped[str]       = mapped_column(String(20), nullable=False)
    filename:    Mapped[str]       = mapped_column(String(500), nullable=False)
    file_path:   Mapped[str]       = mapped_column(String(500), nullable=False)
    file_size:   Mapped[int]       = mapped_column(BigInteger, default=0)
    line_count:  Mapped[int]       = mapped_column(Integer, default=0)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
