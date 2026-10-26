from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

from app.i18n import message as system_message

TASKS = {
    "default": "Default service",
    "todo": "Today's AI TODOs",
    "ticket_analysis": "Ticket analysis",
    "rag_chat": "AI chat (knowledge first)",
}


class ProviderInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    vendor: Literal["openai", "gemini", "deepseek", "qwen", "other"] = "other"
    auth_required: bool = True
    token_parameter: Literal["max_tokens", "max_completion_tokens"] = "max_tokens"
    protocol: Literal["gemini", "openai", "responses"]
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
        if (
            parsed.scheme not in ("https", "http")
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                system_message(
                    "errors.enterAnHttpSApiBaseUrlWithoutCredentialsQueryParametersOr"
                )
            )
        # Validate the port without attempting a network connection.
        try:
            parsed.port
        except ValueError:
            raise ValueError(system_message("errors.invalidApiUrlPort"))
        return value.rstrip("/")


class RouteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: Literal["default", "todo", "ticket_analysis", "rag_chat"]
    provider_id: UUID | None = None
    fallback_provider_id: UUID | None = None
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)
    max_output_tokens: int | None = Field(default=None, ge=16, le=65536)

    @model_validator(mode="after")
    def valid_pair(self):
        if self.provider_id and self.provider_id == self.fallback_provider_id:
            raise ValueError(
                system_message("errors.primaryAndFallbackServicesMustBeDifferent")
            )
        return self


class RoutesInput(BaseModel):
    routes: list[RouteInput] = Field(min_length=len(TASKS), max_length=len(TASKS))

    @model_validator(mode="after")
    def all_tasks(self):
        if {r.task for r in self.routes} != set(TASKS):
            raise ValueError(
                system_message(
                    "errors.primaryAndFallbackServicesMustDifferIncludingInheritedDefaults"
                )
            )
        return self


class TestInput(BaseModel):
    mode: Literal["chat", "json", "stream", "conversation"] = "chat"
