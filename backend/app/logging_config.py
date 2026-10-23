"""Bounded, redacted JSONL logs, deliberately separate from public uploads."""
import json
import logging
import re
import traceback
from contextvars import ContextVar
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from uuid import uuid4

from app.config import settings

request_id_context: ContextVar[str] = ContextVar("request_id", default="")
_secrets: set[str] = set()


def register_secret(value):
    if value and len(value) >= 4 and len(_secrets) < 256:
        _secrets.add(value)


def redact(value: str, limit=4000):
    value = str(value)
    for secret in (settings.app_master_key, *_secrets):
        if secret:
            value = value.replace(secret, "[REDACTED]")
    value = re.sub(r"(?i)Bearer\s+[^\s\"',;]+", "Bearer [REDACTED]", value)
    value = re.sub(r"\bsk-[A-Za-z0-9_-]+", "[REDACTED]", value)
    value = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED]", value)
    value = re.sub(r'''(?i)((?:api[\s_-]?key|password|authorization|cookie|access_token|secret)["']?\s*[:=]\s*)(["'])(.*?)\2''', r"\1\2[REDACTED]\2", value)
    value = re.sub(r'''(?i)((?:api[\s_-]?key|password|authorization|cookie|access_token|secret)["']?\s*[:=]\s*["']?)[^\s,"'}&]+''', r"\1[REDACTED]", value)
    value = re.sub(r"(?i)([?&](?:key|token|api_key|access_token)=)[^&\s]+", r"\1[REDACTED]", value)
    value = re.sub(r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1[REDACTED]@", value)
    return value[:limit]


def safe_data(value, depth=0):
    if depth > 5:
        return "…"
    if isinstance(value, dict):
        return {str(k)[:80]: ("[REDACTED]" if re.search(r"(?i)key|password|authorization|cookie|secret|prompt|raw_response|body|content", str(k)) else safe_data(v, depth + 1)) for k, v in list(value.items())[:50]}
    if isinstance(value, (tuple, list)):
        return [safe_data(v, depth + 1) for v in value[:20]]
    if isinstance(value, str):
        return redact(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact(str(value))


class JSONLogFormatter(logging.Formatter):
    def format(self, record):
        entry = {"id": str(uuid4()), "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
                 "level": record.levelname, "logger": record.name, "message": redact(record.getMessage()),
                 "request_id": request_id_context.get(), "details": safe_data(getattr(record, "details", {}))}
        if record.exc_info and record.exc_info[0]:
            # Exception messages can embed SQL parameters or business text; record only type and frames.
            entry["details"]["exception_type"] = record.exc_info[0].__name__
            entry["details"]["stack"] = [{"file": Path(f.filename).name, "line": f.lineno, "function": f.name} for f in traceback.extract_tb(record.exc_info[2])[-12:]]
        return json.dumps(entry, ensure_ascii=False, allow_nan=False)


def configure_logging():
    directory = Path(settings.log_dir).resolve()
    uploads = Path(settings.upload_dir).resolve()
    if directory == uploads or uploads in directory.parents:
        raise RuntimeError("LOG_DIR 必须位于公开 uploads 目录之外")
    directory.mkdir(parents=True, exist_ok=True)
    handler = next((h for h in logging.getLogger("app").handlers if getattr(h, "fae_json_log", False)), None)
    if handler is None:
        handler = RotatingFileHandler(directory / "app.jsonl", maxBytes=5 * 1024 * 1024, backupCount=4, encoding="utf-8")
        handler.fae_json_log = True
        handler.setFormatter(JSONLogFormatter())
    for name in ("app", "uvicorn.error"):
        logger = logging.getLogger(name)
        if any(getattr(h, "fae_json_log", False) for h in logger.handlers):
            continue
        logger.addHandler(handler)
        if name == "app":
            logger.setLevel(settings.log_level)


def log_event(level, message, **details):
    logging.getLogger("app.events").log(level, message, extra={"details": details})
