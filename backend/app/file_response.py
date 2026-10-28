"""Authenticated streaming downloads with single-byte-range support."""

import hashlib
import re
from email.utils import formatdate

import aiofiles
from fastapi import Request
from fastapi.responses import FileResponse, Response, StreamingResponse


def download_response(request: Request, path, name, media_type):
    stat = path.stat()
    etag = (
        '"'
        + hashlib.sha256(f"{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest()
        + '"'
    )
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "ETag": etag,
        "Last-Modified": formatdate(stat.st_mtime, usegmt=True),
    }
    full = FileResponse(
        path, filename=name, media_type=media_type, headers=headers, stat_result=stat
    )
    value = request.headers.get("range")
    if request.headers.get("if-range") not in (None, etag, headers["Last-Modified"]):
        value = None
    if value:
        match = re.fullmatch(r"bytes=(\d{0,20})-(\d{0,20})", value)
        if not match or not any(match.groups()) or stat.st_size == 0:
            return Response(
                status_code=416,
                headers={**headers, "Content-Range": f"bytes */{stat.st_size}"},
            )
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last) if last else stat.st_size - 1, stat.st_size - 1)
        else:
            start, end = max(0, stat.st_size - int(last)), stat.st_size - 1
        if start > end or start >= stat.st_size:
            return Response(
                status_code=416,
                headers={**headers, "Content-Range": f"bytes */{stat.st_size}"},
            )
        ranged = dict(full.headers)
        ranged.update(
            {
                "Content-Range": f"bytes {start}-{end}/{stat.st_size}",
                "Content-Length": str(end - start + 1),
            }
        )
        if request.method == "HEAD":
            return Response(status_code=206, headers=ranged)

        async def chunks():
            remaining = end - start + 1
            async with aiofiles.open(path, "rb") as file:
                await file.seek(start)
                while remaining:
                    chunk = await file.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(chunks(), status_code=206, headers=ranged)
    if request.method == "HEAD":
        return Response(headers=dict(full.headers))
    return full
