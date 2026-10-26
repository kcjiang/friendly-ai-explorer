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

from app.i18n import message as system_message


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
            raise ValueError(system_message("errors.selectAValidIanaTimeZone"))
        return value

    @field_validator("start", "end")
    @classmethod
    def clock(cls, value):
        parsed = time.fromisoformat(value)
        if len(value) != 5 or parsed.second or parsed.microsecond or parsed.tzinfo:
            raise ValueError(system_message("errors.timeMustUseHhMmFormat"))
        return value

    @model_validator(mode="after")
    def valid(self):
        if self.start >= self.end:
            raise ValueError(system_message("errors.endTimeMustBeAfterStartTime"))
        if len(set(self.weekdays)) != len(self.weekdays) or any(
            d not in range(7) for d in self.weekdays
        ):
            raise ValueError(system_message("errors.invalidWeekdaySettings"))
        if not self.weekdays:
            raise ValueError(system_message("errors.selectAtLeastOneWeekday"))
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
            raise ValueError(system_message("errors.theSiteMustBeAnHttpsRootUrl"))
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
            raise ValueError(
                system_message(
                    "errors.eachAutomationMustContainAtLeastOneStepAndCannotContainDuplicate"
                )
            )
        return self


class Reorder(Input):
    ids: list[UUID] = Field(max_length=200)


class Note(Input):
    note: str = Field(max_length=50000)


class Submit(Input):
    automation_id: UUID
