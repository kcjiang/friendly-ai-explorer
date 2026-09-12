import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, DateTime, Boolean, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id:                 Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id:            Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    email_address:      Mapped[str]            = mapped_column(String(255), nullable=False)
    imap_host:          Mapped[str]            = mapped_column(String(255), nullable=False)
    imap_port:          Mapped[int]            = mapped_column(Integer, default=993)
    username:           Mapped[str]            = mapped_column(String(255), nullable=False)
    password_encrypted: Mapped[str]            = mapped_column(Text, nullable=False)
    use_ssl:            Mapped[bool]           = mapped_column(Boolean, default=True)
    is_active:          Mapped[bool]           = mapped_column(Boolean, default=True)
    last_synced_at:     Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at:         Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    synced_emails: Mapped[list["SyncedEmail"]] = relationship("SyncedEmail", back_populates="account", cascade="all, delete-orphan")


class SyncedEmail(Base):
    __tablename__ = "synced_emails"

    id:                   Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id:           Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("email_accounts.id", ondelete="CASCADE"), nullable=False)
    message_id:           Mapped[str]            = mapped_column(String(500), nullable=False)
    subject:              Mapped[Optional[str]]  = mapped_column(String(500), nullable=True)
    sender:               Mapped[Optional[str]]  = mapped_column(String(500), nullable=True)
    body_text:            Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    received_at:          Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_analyzed:          Mapped[bool]           = mapped_column(Boolean, default=False)
    ai_is_customer_email: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    ai_is_defect_report:  Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    ai_summary:           Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    created_at:           Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    account:     Mapped["EmailAccount"] = relationship("EmailAccount", back_populates="synced_emails")
    pre_tickets: Mapped[list["PreTicket"]] = relationship("PreTicket", back_populates="email", cascade="all, delete-orphan")


class PreTicket(Base):
    __tablename__ = "pre_tickets"

    id:                Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email_id:          Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("synced_emails.id", ondelete="CASCADE"), nullable=False)
    creator_id:        Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title:             Mapped[str]            = mapped_column(String(500), nullable=False)
    description:       Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    customer_name:     Mapped[Optional[str]]  = mapped_column(String(200), nullable=True)
    customer_contact:  Mapped[Optional[str]]  = mapped_column(String(200), nullable=True)
    product_name:      Mapped[Optional[str]]  = mapped_column(String(200), nullable=True)
    firmware_version:  Mapped[Optional[str]]  = mapped_column(String(100), nullable=True)
    priority:          Mapped[str]            = mapped_column(String(50), default="medium")
    status:            Mapped[str]            = mapped_column(String(50), default="pending_review")
    created_ticket_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("tickets.id"), nullable=True)
    created_at:        Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    email: Mapped["SyncedEmail"] = relationship("SyncedEmail", back_populates="pre_tickets")
