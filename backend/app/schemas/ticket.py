import uuid
from datetime import datetime
from typing import Annotated
from urllib.parse import urlsplit
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.ticket import TicketStatus, TicketPriority

Short = Annotated[str, Field(max_length=500)]
Long = Annotated[str, Field(max_length=100000)]
Link = Annotated[str, Field(max_length=2000)]

class UserBrief(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    model_config = ConfigDict(from_attributes=True)

class TicketCommentOut(BaseModel):
    id: uuid.UUID
    ticket_id: uuid.UUID
    content: str
    is_internal: bool
    author: UserBrief
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class TicketListOut(BaseModel):
    id: uuid.UUID
    ticket_no: str
    display_name: str
    legacy_ticket_no: str | None = None
    system_seq: int
    project_id: uuid.UUID | None
    project_seq: int | None
    project_name: str
    project_summary: str
    description: str | None
    next_plan: str
    title: str
    customer_name: str | None
    product_name: str | None
    source: str
    source_number: str
    status: TicketStatus
    status_note: str
    priority: TicketPriority
    assignee: UserBrief | None
    creator: UserBrief
    updater: UserBrief
    revision: int
    can_edit: bool
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class TicketOut(TicketListOut):
    source_url: str
    raw_report: str
    tapd_created: bool
    tapd_url: str
    notes: str
    customer_contact: str | None = None
    firmware_version: str | None = None
    ai_analysis: str | None = None
    ai_suggestions: str | None = None
    tags: list[str] | None = None
    comments: list[TicketCommentOut] = Field(default_factory=list)
    resolved_at: datetime | None

class InputBase(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    @field_validator('source_url', 'tapd_url', check_fields=False)
    @classmethod
    def http_link(cls, value):
        if value:
            try:
                link = urlsplit(value)
                valid = link.scheme in ('http', 'https') and bool(link.netloc)
            except ValueError:
                valid = False
            if not valid:
                raise ValueError('链接必须使用有效的 http:// 或 https:// 地址')
        return value

class CreateTicketRequest(InputBase):
    title: str = Field(min_length=1, max_length=500)
    description: Long = ''
    project_id: uuid.UUID
    source: str = Field(min_length=1, max_length=100)
    source_number: str = Field(default='', max_length=200)
    source_url: Link = ''
    raw_report: Long = ''
    tapd_created: bool = False
    tapd_url: Link = ''
    priority: TicketPriority = TicketPriority.major
    status: TicketStatus = TicketStatus.open
    status_note: Short = ''
    next_plan: Long = ''
    notes: Long = ''
    assignee_id: uuid.UUID | None = None

class UpdateTicketRequest(InputBase):
    revision: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: Long | None = None
    project_id: uuid.UUID | None = None
    source: str | None = Field(default=None, min_length=1, max_length=100)
    source_number: str | None = Field(default=None, max_length=200)
    source_url: Link | None = None
    raw_report: Long | None = None
    tapd_created: bool | None = None
    tapd_url: Link | None = None
    priority: TicketPriority | None = None
    status: TicketStatus | None = None
    status_note: Short | None = None
    next_plan: Long | None = None
    notes: Long | None = None
    assignee_id: uuid.UUID | None = None

    @field_validator('*')
    @classmethod
    def no_explicit_null(cls, value):
        if value is None:
            raise ValueError('字段不可设置为空值；可选文本请使用空字符串')
        return value

class AddCommentRequest(InputBase):
    content: str = Field(min_length=1, max_length=10000)
    is_internal: bool = False

class TicketStatsOut(BaseModel):
    total: int
    open: int
    reproducing: int
    in_progress: int
    verifying: int
    pending: int
    resolved: int
