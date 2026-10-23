"""Mailbox state is separate from the legacy email analysis feature."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WBMailbox(Base):
    __tablename__ = "workbench_mailboxes"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    address: Mapped[str] = mapped_column(String(320))
    username: Mapped[str] = mapped_column(String(320))
    password_encrypted: Mapped[str] = mapped_column(Text)
    imap_host: Mapped[str] = mapped_column(String(255))
    imap_port: Mapped[int] = mapped_column(Integer, default=993)
    imap_security: Mapped[str] = mapped_column(String(16), default="ssl")
    smtp_host: Mapped[str] = mapped_column(String(255))
    smtp_port: Mapped[int] = mapped_column(Integer, default=465)
    smtp_security: Mapped[str] = mapped_column(String(16), default="ssl")
    status: Mapped[str] = mapped_column(String(24), default="idle")
    error: Mapped[str | None] = mapped_column(Text)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WBMailFolder(Base):
    __tablename__ = "workbench_mail_folders"
    __table_args__ = (UniqueConstraint("mailbox_id", "path"),)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    mailbox_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_mailboxes.id", ondelete="CASCADE"), index=True
    )
    path: Mapped[str] = mapped_column(String(1000))
    delimiter: Mapped[str] = mapped_column(String(8), default="/")
    flags: Mapped[list] = mapped_column(JSONB, default=list)
    selectable: Mapped[bool] = mapped_column(Boolean, default=True)
    present: Mapped[bool] = mapped_column(Boolean, default=True)


class WBMailRule(Base):
    __tablename__ = "workbench_mail_rules"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    mailbox_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_mailboxes.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_mail_folders.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(150))
    sender: Mapped[str] = mapped_column(String(320), default="")
    keywords: Mapped[list] = mapped_column(JSONB, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class WBMail(Base):
    __tablename__ = "workbench_emails"
    __table_args__ = (UniqueConstraint("mailbox_id", "source_key"),)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    mailbox_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_mailboxes.id", ondelete="CASCADE"), index=True
    )
    source_key: Mapped[str] = mapped_column(String(64))
    message_id: Mapped[str] = mapped_column(Text)
    subject: Mapped[str] = mapped_column(Text)
    sender: Mapped[str] = mapped_column(Text)
    recipients: Mapped[str] = mapped_column(Text)
    cc: Mapped[str] = mapped_column(Text, default="")
    body_text: Mapped[str] = mapped_column(Text)
    body_html: Mapped[str] = mapped_column(Text)
    raw: Mapped[bytes] = mapped_column(LargeBinary)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workbench_mail_rules.id", ondelete="SET NULL")
    )


class WBMailLocation(Base):
    __tablename__ = "workbench_mail_locations"
    __table_args__ = (UniqueConstraint("folder_id", "validity", "uid"),)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    mail_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_emails.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_mail_folders.id", ondelete="CASCADE"), index=True
    )
    validity: Mapped[str] = mapped_column(String(64))
    uid: Mapped[str] = mapped_column(String(32))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)


class WBMessageMail(Base):
    __tablename__ = "workbench_message_emails"
    __table_args__ = (UniqueConstraint("message_id", "mail_id"),)
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_messages.id", ondelete="CASCADE"), index=True
    )
    mail_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_emails.id", ondelete="CASCADE"), index=True
    )


class WBMailDelivery(Base):
    __tablename__ = "workbench_mail_deliveries"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    mailbox_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workbench_mailboxes.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(24))
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
