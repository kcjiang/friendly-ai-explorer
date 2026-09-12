import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from app.models.document import DocVisibility


class AuthorBrief(BaseModel):
    id:   uuid.UUID
    name: str
    model_config = {"from_attributes": True}


class DocumentListOut(BaseModel):
    """文档列表条目（不含正文，轻量）"""
    id:                 uuid.UUID
    title:              str
    content_type:       str
    file_original_name: Optional[str]
    visibility:         DocVisibility
    is_published:       bool
    tags:               Optional[list[str]]
    view_count:         int
    author:             AuthorBrief
    created_at:         datetime
    updated_at:         datetime
    model_config = {"from_attributes": True}


class DocumentOut(BaseModel):
    """文档详情（含正文）"""
    id:                 uuid.UUID
    title:              str
    content:            Optional[str]
    content_type:       str
    file_url:           Optional[str]
    file_original_name: Optional[str]
    visibility:         DocVisibility
    is_published:       bool
    tags:               Optional[list[str]]
    view_count:         int
    author:             AuthorBrief
    created_at:         datetime
    updated_at:         datetime
    model_config = {"from_attributes": True}


class CreateDocumentRequest(BaseModel):
    title:      str
    content:    Optional[str]          = None
    visibility: DocVisibility          = DocVisibility.public
    is_published: bool                 = False
    tags:       Optional[list[str]]    = None


class UpdateDocumentRequest(BaseModel):
    title:        Optional[str]         = None
    content:      Optional[str]         = None
    visibility:   Optional[DocVisibility] = None
    is_published: Optional[bool]        = None
    tags:         Optional[list[str]]   = None
