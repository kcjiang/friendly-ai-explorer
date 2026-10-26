import json
import logging
import re
import time
from uuid import uuid4

from app.logging_config import log_event, request_id_context


class RequestLoggingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        incoming = (
            dict(scope.get("headers", []))
            .get(b"x-request-id", b"")
            .decode("ascii", errors="ignore")
        )
        request_id = (
            incoming if re.fullmatch(r"[A-Za-z0-9_-]{8,64}", incoming) else str(uuid4())
        )
        token = request_id_context.set(request_id)
        started, status, failed, response_started = time.monotonic(), 500, False, False

        async def response_send(message):
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if k.lower() != b"x-request-id"
                ]
                message = {
                    **message,
                    "headers": headers + [(b"x-request-id", request_id.encode())],
                }
            await send(message)

        try:
            await self.app(scope, receive, response_send)
        except Exception:
            failed = True
            logging.getLogger("app.http").exception(
                "请求处理发生未捕获异常",
                extra={
                    "details": {
                        "method": scope["method"],
                        "path": scope.get("path", ""),
                    }
                },
            )
            if response_started:
                raise
            body = json.dumps(
                {
                    "detail": "服务器处理请求失败，请使用请求编号查看应用日志",
                    "request_id": request_id,
                },
                ensure_ascii=False,
            ).encode("utf-8")
            await response_send(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await response_send({"type": "http.response.body", "body": body})
        finally:
            path = scope.get("path", "")
            elapsed = round((time.monotonic() - started) * 1000)
            # Polling the log reader and healthcheck should not generate their own noise.
            if (
                failed
                or status >= 400
                or (path != "/health" and not path.startswith("/api/v1/admin/logs"))
            ):
                level = (
                    logging.ERROR
                    if failed or status >= 500
                    else logging.WARNING
                    if status >= 400
                    else logging.INFO
                )
                log_event(
                    level,
                    "HTTP 请求完成",
                    method=scope["method"],
                    path=path,
                    status=500 if failed else status,
                    elapsed_ms=elapsed,
                )
            request_id_context.reset(token)
