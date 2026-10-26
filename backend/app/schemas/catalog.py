from datetime import date
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.i18n import message as system_message

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
ShortName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ContactMethod(StrictModel):
    type: ShortName
    value: Annotated[str, StringConstraints(min_length=1, max_length=2000)]


class Contact(StrictModel):
    name: Name
    gender: Literal["male", "female", "other", "unspecified"] = "unspecified"
    position: Annotated[str, StringConstraints(max_length=200)] = ""
    methods: list[ContactMethod] = Field(default_factory=list, max_length=30)
    notes: Notes = ""


class CustomerInput(StrictModel):
    company_name: Name
    country_code: Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
    business: list[ShortName] = Field(default_factory=list, max_length=30)
    level: ShortName
    contacts: list[Contact] = Field(default_factory=list, max_length=100)
    notes: Notes = ""


class ProductInput(StrictModel):
    type: ShortName
    model: Name
    chipset: Name
    system: Name
    repository_url: Annotated[str, StringConstraints(max_length=2000)] = ""
    fingerprint: Annotated[str, StringConstraints(max_length=10000)] = ""
    notes: Notes = ""

    @field_validator("repository_url")
    @classmethod
    def validate_url(cls, value):
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise ValueError(
                    system_message("errors.theFirmwareDownloadUrlMustUseHttpOrHttps")
                )
        return value


class ProjectInput(StrictModel):
    number: ShortName
    pm: ShortName
    fae_id: UUID | None = None
    start_date: date
    stage: ShortName
    customer_id: UUID
    product_id: UUID


class CatalogOptionInput(StrictModel):
    value: ShortName
