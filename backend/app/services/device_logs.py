"""Shared destinations and browser-local log filenames for both upload APIs."""

import re
import secrets
from datetime import datetime, timedelta, timezone

from app.services import storage_service as storage


def log_name(kind, requested=None, *, at=None, offset=-480):
    if kind not in ("adb", "serial"):
        storage.fail(400, "Unsupported device type")
    if requested and re.fullmatch(
        rf"{kind}_\d{{8}}_\d{{6}}_[0-9a-f]{{4}}\.log", requested
    ):
        try:
            datetime.strptime(requested[len(kind) + 1 : -9], "%Y%m%d_%H%M%S")
            return requested
        except ValueError:
            pass
    local = (at or datetime.now(timezone.utc)).astimezone(
        timezone(timedelta(minutes=-offset))
    )
    return f"{kind}_{local:%Y%m%d_%H%M%S}_{secrets.token_hex(2)}.log"


async def destination(db, user, space, kind, name):
    if kind not in ("adb", "serial"):
        storage.fail(400, "Unsupported device type")
    storage.disk_path(space).mkdir(parents=True, exist_ok=True)
    parent = ""
    for folder in ("DeviceLogs", kind):
        path = "/".join(filter(None, [parent, folder]))
        target = storage.disk_path(space, path)
        if target.exists() and not target.is_dir():
            storage.fail(409, f"日志目录 {path} 已被同名文件占用")
        if not target.exists():
            await storage.create_folder(db, user, space, parent, folder)
        parent = path
    directory = storage.disk_path(space, parent)
    for _ in range(64):
        if not (directory / name).exists():
            return parent, name
        name = f"{name[:-9]}_{secrets.token_hex(2)}.log"
    storage.fail(409, "日志文件名冲突，请重试")
