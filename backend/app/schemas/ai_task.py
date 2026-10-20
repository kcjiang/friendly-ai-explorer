import re
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID
from pydantic import BaseModel, Field, SecretStr, field_validator

DEFAULT_FIELDS = ["问题表现及描述", "前置条件", "复现步骤", "预期结果", "实际结果", "出现概率", "Log附件", "分析", "附件", "客户缺陷原始描述"]


class AccountBody(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    base_url: str = Field(max_length=500)
    username: str = Field(min_length=1, max_length=255)
    password: SecretStr | None = None

    @field_validator("base_url")
    @classmethod
    def url(cls, value):
        value = value.strip().rstrip("/")
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError("请填写 HTTPS Jira 站点地址，不含账号、查询参数或问题路径")
        if "/browse/" in parts.path or "/rest/" in parts.path:
            raise ValueError("请填写 Jira 站点根地址，可保留 /jira 等上下文路径")
        return value


class TaskBody(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    account_id: UUID
    jql: str = Field(min_length=1, max_length=5000)
    interval_minutes: int = Field(default=60, ge=5, le=10080)
    enabled: bool = False


class TemplateBody(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    fields: list[str] = Field(min_length=1, max_length=30)

    @field_validator("fields")
    @classmethod
    def clean_fields(cls, values):
        values = [re.sub(r"[：:]$", "", v.strip().strip("*")).strip() for v in values]
        if any(not v or len(v) > 100 for v in values) or len(set(values)) != len(values):
            raise ValueError("模板字段不能为空、重复或超过100字")
        return values


class ConvertBody(BaseModel):
    template_id: UUID | None = None
    prompt_id: UUID | None = None
    language: Literal["zh-CN", "en"] | None = None


class PromptBody(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    content: str = Field(min_length=10, max_length=20000)
    revision: int | None = Field(default=None, ge=1)

    @field_validator("name", "content")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("内容不能为空")
        return value.strip()


class PreferenceBody(BaseModel):
    prompt_id: UUID | None = None
    language: Literal["zh-CN", "en"] = "zh-CN"


class DraftBody(BaseModel):
    fields: dict[str, str] = Field(max_length=30)


class ProcessBody(BaseModel):
    processed: bool
