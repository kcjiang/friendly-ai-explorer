import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class EmailAccountSetup(BaseModel):
    email_address: str
    imap_host:     str
    imap_port:     int  = 993
    username:      str
    password:      str
    use_ssl:       bool = True


class EmailAccountOut(BaseModel):
    id:             uuid.UUID
    email_address:  str
    imap_host:      str
    imap_port:      int
    username:       str
    use_ssl:        bool
    is_active:      bool
    last_synced_at: Optional[datetime]
    created_at:     datetime
    model_config = {"from_attributes": True}


class SyncedEmailOut(BaseModel):
    id:                   uuid.UUID
    message_id:           str
    subject:              Optional[str]
    sender:               Optional[str]
    body_text:            Optional[str]
    received_at:          Optional[datetime]
    is_analyzed:          bool
    ai_is_customer_email: Optional[bool]
    ai_is_defect_report:  Optional[bool]
    ai_summary:           Optional[str]
    created_at:           datetime
    model_config = {"from_attributes": True}


class PreTicketOut(BaseModel):
    id:                uuid.UUID
    email_id:          uuid.UUID
    title:             str
    description:       Optional[str]
    customer_name:     Optional[str]
    customer_contact:  Optional[str]
    product_name:      Optional[str]
    firmware_version:  Optional[str]
    priority:          str
    status:            str
    created_ticket_id: Optional[uuid.UUID]
    created_at:        datetime
    # 关联邮件摘要
    email_subject:     Optional[str] = None
    email_sender:      Optional[str] = None
    model_config = {"from_attributes": True}


class SyncRequest(BaseModel):
    limit: int = 50  # 0 = 不限制


class UpdatePreTicketRequest(BaseModel):
    title:            Optional[str] = None
    description:      Optional[str] = None
    customer_name:    Optional[str] = None
    customer_contact: Optional[str] = None
    product_name:     Optional[str] = None
    firmware_version: Optional[str] = None
    priority:         Optional[str] = None
