"""Request language and durable system messages, independent of user accounts."""

import json
from contextvars import ContextVar

output_locale = ContextVar("output_locale", default="en")
SUPPORTED_LOCALES = frozenset(("en", "zh-CN"))


def normalize_locale(value):
    return value if value in SUPPORTED_LOCALES else "en"


def language_instruction(locale=None):
    language = (
        "Simplified Chinese"
        if normalize_locale(locale or output_locale.get()) == "zh-CN"
        else "English"
    )
    return (
        f"\n\nOutput language: {language}. Write all generated user-facing prose in this language, "
        "even when source material or earlier messages use another language. "
        "Preserve quotations, source facts, identifiers, commands and technical abbreviations. "
        "Keep JSON property names and enum values unchanged."
    )


def message(code, **params):
    """A stable envelope that survives existing text columns and exception boundaries."""
    return "@i18n:" + json.dumps(
        {"code": code, "params": params}, ensure_ascii=False, separators=(",", ":")
    )


def message_details(value):
    if not isinstance(value, str) or "@i18n:" not in value:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(value.split("@i18n:", 1)[1])
        if (
            isinstance(data, dict)
            and isinstance(data.get("code"), str)
            and isinstance(data.get("params"), dict)
        ):
            return data
    except (ValueError, TypeError):
        pass
    return None


class LanguageMiddleware:
    """Pure ASGI middleware keeps context alive through streamed responses."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        locale = normalize_locale(
            headers.get(b"x-fae-locale", b"en").decode("ascii", errors="ignore")
        )
        token = output_locale.set(locale)
        try:
            await self.app(scope, receive, send)
        finally:
            output_locale.reset(token)
