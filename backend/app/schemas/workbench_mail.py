import base64
import re
from typing import Literal
from uuid import UUID

from pydantic import EmailStr, Field, SecretStr, field_validator, model_validator

from app.i18n import message as system_message
from app.schemas.workbench import Input


class Mailbox(Input):
    address: EmailStr
    username: str = Field(min_length=1, max_length=320)
    password: SecretStr | None = None
    imap_host: str = Field(min_length=1, max_length=255)
    imap_port: int = Field(default=993, ge=1, le=65535)
    imap_security: Literal["ssl", "starttls"] = "ssl"
    smtp_host: str = Field(min_length=1, max_length=255)
    smtp_port: int = Field(default=465, ge=1, le=65535)
    smtp_security: Literal["ssl", "starttls"] = "ssl"

    @field_validator("imap_host", "smtp_host")
    @classmethod
    def host(cls, value):
        if not re.fullmatch(r"[a-zA-Z0-9.-]+", value):
            raise ValueError(
                system_message(
                    "errors.enterAMailboxServerHostnameUrlsProtocolsAndPortsAreNotAllowed"
                )
            )
        return value.lower()


class Folder(Input):
    name: str = Field(min_length=1, max_length=1000)

    @field_validator("name")
    @classmethod
    def safe(cls, value):
        if any(ord(char) < 32 for char in value):
            raise ValueError(
                system_message("errors.folderNamesCannotContainControlCharacters")
            )
        return value


class Rule(Input):
    name: str = Field(min_length=1, max_length=150)
    folder_id: UUID
    sender: str = Field(default="", max_length=320)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    enabled: bool = True

    @model_validator(mode="after")
    def condition(self):
        self.keywords = [word.strip()[:200] for word in self.keywords if word.strip()]
        if not self.sender and not self.keywords:
            raise ValueError(
                system_message("errors.enterAtLeastASenderOrASubjectKeyword")
            )
        return self


class Attachment(Input):
    name: str = Field(min_length=1, max_length=255)
    data: str = Field(max_length=7_000_000)

    @model_validator(mode="after")
    def valid(self):
        try:
            raw = base64.b64decode(self.data, validate=True)
        except Exception:
            raise ValueError(
                system_message("errors.invalidAttachmentEncoding")
            ) from None
        if len(raw) > 5_000_000:
            raise ValueError(
                system_message("errors.eachAttachmentMustBeNoLargerThan5Mb")
            )
        return self


class Send(Input):
    id: UUID
    to: list[EmailStr] = Field(min_length=1, max_length=100)
    cc: list[EmailStr] = Field(default_factory=list, max_length=100)
    bcc: list[EmailStr] = Field(default_factory=list, max_length=100)
    subject: str = Field(max_length=1000)
    html: str = Field(max_length=10_000_000)
    text: str = Field(max_length=1_000_000)
    in_reply_to: str = Field(default="", max_length=1000)
    attachments: list[Attachment] = Field(default_factory=list, max_length=10)

    @field_validator("subject", "in_reply_to")
    @classmethod
    def header(cls, value):
        if "\r" in value or "\n" in value:
            raise ValueError(system_message("errors.mailHeadersCannotContainNewlines"))
        return value

    @model_validator(mode="after")
    def size(self):
        if len(self.html) + sum(len(a.data) for a in self.attachments) > 14_000_000:
            raise ValueError(
                system_message("errors.theEmailIsTooLargeReduceAttachmentsOrImages")
            )
        return self
