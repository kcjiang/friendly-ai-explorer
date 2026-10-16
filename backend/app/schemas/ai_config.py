from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

TASKS = {"default": "默认服务", "todo": "今日 AI TODO", "ticket_analysis": "工单分析", "email_analysis": "邮件分析", "rag_chat": "AI 对话（知识库优先）"}


class ProviderInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    protocol: Literal["gemini", "openai"]
    base_url: str = Field(min_length=1, max_length=1000)
    model: str = Field(min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_.:/-]+$")
    api_key: SecretStr | None = None
    enabled: bool = True
    timeout_seconds: int = Field(default=90, ge=5, le=300)
    max_output_tokens: int = Field(default=2048, ge=16, le=65536)
    max_concurrency: int = Field(default=1, ge=1, le=32)
    thinking_mode: Literal["auto", "off", "on"] = "auto"
    structured_output: Literal["auto", "schema", "object", "off"] = "auto"
    temperature: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)
    retry_count: int = Field(default=1, ge=0, le=2)

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        parsed = urlsplit(value)
        if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("请输入无用户名、密码、查询参数的 HTTP(S) API Base URL")
        # Validate the port without attempting a network connection.
        try:
            parsed.port
        except ValueError:
            raise ValueError("API 地址端口无效")
        return value.rstrip("/")


class RouteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: Literal["default", "todo", "ticket_analysis", "email_analysis", "rag_chat"]
    provider_id: UUID | None = None
    fallback_provider_id: UUID | None = None
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)
    max_output_tokens: int | None = Field(default=None, ge=16, le=65536)

    @model_validator(mode="after")
    def valid_default(self):
        if self.task == "default" and self.provider_id is None:
            raise ValueError("默认服务不能为空")
        if self.provider_id and self.provider_id == self.fallback_provider_id:
            raise ValueError("主服务与备用服务不能相同")
        return self


class RoutesInput(BaseModel):
    routes: list[RouteInput] = Field(min_length=5, max_length=5)

    @model_validator(mode="after")
    def all_tasks(self):
        if {r.task for r in self.routes} != set(TASKS):
            raise ValueError("必须包含默认服务和全部四项任务，且不能重复")
        return self


class TestInput(BaseModel):
    mode: Literal["chat", "json", "stream"] = "chat"
