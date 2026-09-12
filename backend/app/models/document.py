import uuid
import enum
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, DateTime, Enum as SAEnum, ForeignKey, Boolean, Integer, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector
from app.database import Base


class DocVisibility(str, enum.Enum):
    public  = "public"
    private = "private"


class Document(Base):
    __tablename__ = "documents"

    id:                 Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title:              Mapped[str]            = mapped_column(String(500), nullable=False)
    content:            Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    content_type:       Mapped[str]            = mapped_column(String(50), default="markdown")
    file_url:           Mapped[Optional[str]]  = mapped_column(String(500), nullable=True)
    file_original_name: Mapped[Optional[str]]  = mapped_column(String(255), nullable=True)
    visibility:         Mapped[DocVisibility]  = mapped_column(SAEnum(DocVisibility, name="doc_visibility"), default=DocVisibility.public)
    author_id:          Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    is_published:       Mapped[bool]           = mapped_column(Boolean, default=False)
    tags:               Mapped[Optional[list]] = mapped_column(ARRAY(String), nullable=True)
    view_count:         Mapped[int]            = mapped_column(Integer, default=0)
    created_at:         Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at:         Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    author: Mapped["User"]                = relationship("User", foreign_keys=[author_id])
    chunks: Mapped[list["DocumentChunk"]] = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id:          Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int]            = mapped_column(Integer, nullable=False)
    content:     Mapped[str]            = mapped_column(Text, nullable=False)
    embedding:   Mapped[Optional[list]] = mapped_column(Vector(768), nullable=True)
    metadata_:   Mapped[Optional[dict]] = mapped_column("metadata", JSONB, default=dict)
    created_at:  Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    document: Mapped["Document"] = relationship("Document", back_populates="chunks")
