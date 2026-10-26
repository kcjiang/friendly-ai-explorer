"""HTTP error envelopes shared by all API routes."""

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.ai.provider_client import AIError
from app.i18n import message_details
from app.logging_config import request_id_context


def error_payload(code: str) -> dict:
    return {"code": code, "params": {}}


async def ai_error_handler(request: Request, exc: AIError) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={
            "error": message_details(str(exc)) or error_payload("errors.aiUnavailable"),
            "request_id": request_id_context.get(),
        },
    )


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    content = {
        "error": message_details(exc.detail)
        or error_payload(f"errors.http{exc.status_code}"),
        "request_id": request_id_context.get(),
    }
    if isinstance(exc.detail, list):
        content["detail"] = [
            {
                "loc": item.get("loc", []),
                "type": item.get("type", "invalid"),
                "error": error_payload("errors.invalidField"),
            }
            for item in exc.detail
            if isinstance(item, dict)
        ]
    return JSONResponse(
        status_code=exc.status_code, headers=exc.headers, content=content
    )


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    issues = [
        {
            "loc": list(item["loc"]),
            "type": item["type"],
            "error": message_details(item["msg"])
            or error_payload("errors.invalidField"),
        }
        for item in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": error_payload("errors.invalidField"),
            "detail": issues,
            "request_id": request_id_context.get(),
        },
    )
