import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from app.models.ticket import TicketStatus, TicketPriority


class UserBrief(BaseModel):
    id:    uuid.UUID
    name:  str
    email: str
    role:  str
    model_config = {"from_attributes": True}


class TicketCommentOut(BaseModel):
    id:          uuid.UUID
    ticket_id:   uuid.UUID
    content:     str
    is_internal: bool
    author:      UserBrief
    created_at:  datetime
    model_config = {"from_attributes": True}


class TicketListOut(BaseModel):
    """工单列表条目（不含评论，轻量）"""
    id:            uuid.UUID
    ticket_no:     str
    title:         str
    customer_name: Optional[str]
    product_name:  Optional[str]
    status:        TicketStatus
    priority:      TicketPriority
    assignee:      Optional[UserBrief]
    creator:       UserBrief
    created_at:    datetime
    updated_at:    datetime
    model_config = {"from_attributes": True}


class TicketOut(BaseModel):
    """工单详情（含评论）"""
    id:               uuid.UUID
    ticket_no:        str
    title:            str
    description:      Optional[str]
    customer_name:    Optional[str]
    customer_contact: Optional[str]
    product_name:     Optional[str]
    firmware_version: Optional[str]
    status:           TicketStatus
    priority:         TicketPriority
    assignee:         Optional[UserBrief]
    creator:          UserBrief
    ai_analysis:      Optional[str]
    ai_suggestions:   Optional[str]
    tags:             Optional[list[str]]
    comments:         list[TicketCommentOut] = []
    created_at:       datetime
    updated_at:       datetime
    resolved_at:      Optional[datetime]
    model_config = {"from_attributes": True}


class CreateTicketRequest(BaseModel):
    title:            str
    description:      Optional[str]       = None
    customer_name:    Optional[str]       = None
    customer_contact: Optional[str]       = None
    product_name:     Optional[str]       = None
    firmware_version: Optional[str]       = None
    priority:         TicketPriority      = TicketPriority.medium
    assignee_id:      Optional[uuid.UUID] = None
    tags:             Optional[list[str]] = None


class UpdateTicketRequest(BaseModel):
    title:            Optional[str]          = None
    description:      Optional[str]          = None
    customer_name:    Optional[str]          = None
    customer_contact: Optional[str]          = None
    product_name:     Optional[str]          = None
    firmware_version: Optional[str]          = None
    status:           Optional[TicketStatus]   = None
    priority:         Optional[TicketPriority] = None
    assignee_id:      Optional[uuid.UUID]    = None
    tags:             Optional[list[str]]    = None


class AddCommentRequest(BaseModel):
    content:     str
    is_internal: bool = False


class TicketStatsOut(BaseModel):
    total:       int
    open:        int
    in_progress: int
    pending:     int
    resolved:    int
    closed:      int
