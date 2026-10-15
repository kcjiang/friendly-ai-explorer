import json
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.logging_config import safe_data


def reverse_lines(path):
    """Read newest first without loading a multi-megabyte log file into memory."""
    try:
        with path.open("rb") as file:
            file.seek(0, 2)
            position, rest = file.tell(), b""
            while position:
                size = min(position, 65536)
                position -= size
                file.seek(position)
                chunks = (file.read(size) + rest).split(b"\n")
                rest = chunks.pop(0)
                for line in reversed(chunks):
                    if line:
                        yield line
            if rest:
                yield rest
    except FileNotFoundError:
        return


def read_logs(*, level=None, q="", request_id="", since=None, until=None, page=1, page_size=50):
    q = q.casefold()
    directory = Path(settings.log_dir)
    paths = [directory / "app.jsonl"] + [directory / f"app.jsonl.{i}" for i in range(1, 5)]
    items, total, scanned, truncated = [], 0, 0, False
    for path in paths:
        for raw in reverse_lines(path):
            scanned += 1
            if scanned > 10000:
                truncated = True
                break
            try:
                row = json.loads(raw)
                timestamp = datetime.fromisoformat(row["timestamp"])
                if timestamp.tzinfo is None:
                    timestamp = timestamp.replace(tzinfo=timezone.utc)
                if level and row.get("level") != level:
                    continue
                if request_id and row.get("request_id") != request_id:
                    continue
                if since and timestamp < since or until and timestamp > until:
                    continue
                row = safe_data(row)
                if q and q not in json.dumps(row, ensure_ascii=False).casefold():
                    continue
                if (page - 1) * page_size <= total < page * page_size:
                    items.append(row)
                total += 1
            except (ValueError, KeyError, TypeError):
                continue  # tolerate partial writes / rotation
        if truncated:
            break
    return {"items": items, "total": total, "page": page, "page_size": page_size, "truncated": truncated}
