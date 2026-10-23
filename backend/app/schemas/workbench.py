from datetime import time
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Schedule(Input):
    enabled: bool = False
    interval_minutes: Literal[15, 30, 60, 120, 180, 240] = 60
    timezone: str = "Asia/Shanghai"
    weekdays: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4], max_length=7)
    start: str = "09:00"
    end: str = "18:00"

    @field_validator("timezone")
    @classmethod
    def zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("请选择有效的 IANA 时区")
        return value

    @field_validator("start", "end")
    @classmethod
    def clock(cls, value):
        parsed = time.fromisoformat(value)
        if len(value) != 5 or parsed.second or parsed.microsecond or parsed.tzinfo:
            raise ValueError("时间格式必须是 HH:mm")
        return value

    @model_validator(mode="after")
    def valid(self):
        if self.start >= self.end:
            raise ValueError("结束时间必须晚于开始时间")
        if len(set(self.weekdays)) != len(self.weekdays) or any(
            d not in range(7) for d in self.weekdays
        ):
            raise ValueError("工作日设置无效")
        if not self.weekdays:
            raise ValueError("至少设置一个工作日")
        return self


class Account(Input):
    name: str = Field(min_length=1, max_length=150)
    platform: Literal["jira", "youtrack"]
    base_url: str = Field(min_length=1, max_length=500)
    username: str = Field(min_length=1, max_length=255)
    password: SecretStr | None = None
    project_id: UUID | None = None
    mail_folder_id: UUID | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def site(self):
        self.base_url = self.base_url.rstrip("/")
        parts = urlsplit(self.base_url)
        if (
            parts.scheme != "https"
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
        ):
            raise ValueError("网站须为 HTTPS 根地址")
        return self


class Step(Input):
    type: Literal["read", "ai", "map", "ticket", "result"]
    instruction: str = Field(default="", max_length=10000)
    project_id: UUID | None = None
    priority: Literal["critical", "major", "trivial"] = "major"


class Automation(Input):
    name: str = Field(min_length=1, max_length=150)
    steps: list[Step] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def valid(self):
        if sum(s.type == "ticket" for s in self.steps) > 1:
            raise ValueError("每个自动化最多包含一个创建工单操作")
        return self


class Reorder(Input):
    ids: list[UUID] = Field(max_length=200)


class Note(Input):
    note: str = Field(max_length=50000)


class Submit(Input):
    automation_id: UUID
