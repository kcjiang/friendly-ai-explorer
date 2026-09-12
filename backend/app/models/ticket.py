import enum
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, DateTime, Enum as SAEnum, ForeignKey, Boolean, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class TicketStatus(str, enum.Enum):
    open        = "open"
    in_progress = "in_progress"
    pending     = "pending"
    resolved    = "resolved"
    closed      = "closed"


class TicketPriority(str, enum.Enum):
    critical = "critical"
    high     = "high"
    medium   = "medium"
    low      = "low"


class Ticket(Base):
    __tablename__ = "tickets"

    id:               Mapped[uuid.UUID]          = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_no:        Mapped[str]                = mapped_column(String(50), unique=True, nullable=False)
    title:            Mapped[str]                = mapped_column(String(500), nullable=False)
    description:      Mapped[Optional[str]]      = mapped_column(Text, nullable=True)
    customer_name:    Mapped[Optional[str]]      = mapped_column(String(200), nullable=True)
    customer_contact: Mapped[Optional[str]]      = mapped_column(String(200), nullable=True)
    product_name:     Mapped[Optional[str]]      = mapped_column(String(200), nullable=True)
    firmware_version: Mapped[Optional[str]]      = mapped_column(String(100), nullable=True)
    status:           Mapped[TicketStatus]       = mapped_column(SAEnum(TicketStatus,   name="ticket_status"),   nullable=False, default=TicketStatus.open)
    priority:         Mapped[TicketPriority]     = mapped_column(SAEnum(TicketPriority, name="ticket_priority"), nullable=False, default=TicketPriority.medium)
    assignee_id:      Mapped[Optional[uuid.UUID]]= mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    creator_id:       Mapped[uuid.UUID]          = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    ai_analysis:      Mapped[Optional[str]]      = mapped_column(Text, nullable=True)
    ai_suggestions:   Mapped[Optional[str]]      = mapped_column(Text, nullable=True)
    tags:             Mapped[Optional[list]]      = mapped_column(ARRAY(String), nullable=True)
    attachments:      Mapped[Optional[dict]]      = mapped_column(JSONB, default=list)
    created_at:       Mapped[datetime]           = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at:       Mapped[datetime]           = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    resolved_at:      Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    creator:  Mapped["User"]               = relationship("User", foreign_keys=[creator_id])
    assignee: Mapped[Optional["User"]]     = relationship("User", foreign_keys=[assignee_id])
    comments: Mapped[list["TicketComment"]]= relationship("TicketComment", back_populates="ticket", cascade="all, delete-orphan")


class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    author_id:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    content:     Mapped[str]       = mapped_column(Text, nullable=False)
    is_internal: Mapped[bool]      = mapped_column(Boolean, default=False)
    created_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    ticket: Mapped["Ticket"] = relationship("Ticket", back_populates="comments")
    author: Mapped["User"]   = relationship("User", foreign_keys=[author_id])
