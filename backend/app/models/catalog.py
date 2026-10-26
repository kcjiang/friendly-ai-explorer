import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuditMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    revision: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )


class Customer(AuditMixin, Base):
    __tablename__ = "catalog_customers"
    company_name: Mapped[str] = mapped_column(String(200))
    country_code: Mapped[str] = mapped_column(String(2))
    country_name: Mapped[str] = mapped_column(String(100))
    identification_name: Mapped[str] = mapped_column(String(340), unique=True)
    business: Mapped[list] = mapped_column(JSONB, default=list)
    level: Mapped[str] = mapped_column(String(100))
    contacts: Mapped[list] = mapped_column(JSONB, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")


class Product(AuditMixin, Base):
    __tablename__ = "catalog_products"
    identification_name: Mapped[str] = mapped_column(String(340), unique=True)
    type: Mapped[str] = mapped_column(String(100))
    model: Mapped[str] = mapped_column(String(200))
    chipset: Mapped[str] = mapped_column(String(200))
    system: Mapped[str] = mapped_column(String(200))
    repository_url: Mapped[str] = mapped_column(String(2000), default="")
    fingerprint: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class Project(AuditMixin, Base):
    __tablename__ = "catalog_projects"
    number: Mapped[str] = mapped_column(String(100))
    pm: Mapped[str] = mapped_column(String(100))
    fae_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    start_date: Mapped[date] = mapped_column(Date)
    stage: Mapped[str] = mapped_column(String(100))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog_customers.id"))
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog_products.id"))


class CatalogOption(Base):
    __tablename__ = "catalog_options"
    category: Mapped[str] = mapped_column(String(30), primary_key=True)
    value: Mapped[str] = mapped_column(String(100), primary_key=True)
