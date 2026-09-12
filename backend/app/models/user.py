import enum
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class UserRole(str, enum.Enum):
    developer = "developer"
    leader    = "leader"
    engineer  = "engineer"


class User(Base):
    __tablename__ = "users"

    id:            Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email:         Mapped[str]       = mapped_column(String(255), unique=True, nullable=False)
    name:          Mapped[str]       = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str]       = mapped_column(String(255), nullable=False)
    role:          Mapped[UserRole]  = mapped_column(SAEnum(UserRole, name="user_role"), nullable=False, default=UserRole.engineer)
    avatar_url:    Mapped[str | None]= mapped_column(String(500), nullable=True)
    is_active:     Mapped[bool]      = mapped_column(Boolean, default=True)
    created_at:    Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at:    Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
