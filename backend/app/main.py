import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from app.ai.provider_client import AIError
from app.i18n import LanguageMiddleware, message_details
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError

from app.config import settings
from app.logging_config import configure_logging, log_event, request_id_context
from app.middleware.request_logging import RequestLoggingMiddleware
import logging
from app.version import APP_VERSION
from app.routers import auth, tickets, knowledge, ai, admin, users, preset_router, catalog, ai_admin, app_logs
from app.routers import workbench
from app.routers import workbench_mail

configure_logging()
log_event(logging.INFO, "后端应用已加载", version=APP_VERSION)

app = FastAPI(
    title="Friendly AI Explorer API",
    version=APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)


@app.exception_handler(AIError)
async def ai_error_handler(request, exc):
    return JSONResponse(status_code=502, content={"error": message_details(str(exc)) or {"code": "errors.aiUnavailable", "params": {}}, "request_id": request_id_context.get()})


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request, exc):
    error = message_details(exc.detail)
    if error is None:
        error = {"code": f"errors.http{exc.status_code}", "params": {}}
    content = {"error": error, "request_id": request_id_context.get()}
    if isinstance(exc.detail, list):
        content["detail"] = [{"loc": item.get("loc", []), "type": item.get("type", "invalid"), "error": {"code": "errors.invalidField", "params": {}}} for item in exc.detail if isinstance(item, dict)]
    return JSONResponse(status_code=exc.status_code, headers=exc.headers, content=content)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    issues = [{"loc": list(item["loc"]), "type": item["type"], "error": message_details(item["msg"]) or {"code": "errors.invalidField", "params": {}}} for item in exc.errors()]
    return JSONResponse(status_code=422, content={"error": {"code": "errors.invalidField", "params": {}}, "detail": issues, "request_id": request_id_context.get()})

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://frontend:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(LanguageMiddleware)

os.makedirs(settings.upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")

app.include_router(auth.router,          prefix="/api/v1/auth",      tags=["Auth"])
app.include_router(users.router,         prefix="/api/v1/users",     tags=["Users"])
app.include_router(tickets.router,       prefix="/api/v1/tickets",   tags=["Tickets"])
app.include_router(knowledge.router,     prefix="/api/v1/knowledge", tags=["Knowledge"])
app.include_router(ai.router,            prefix="/api/v1/ai",        tags=["AI"])
app.include_router(admin.router,         prefix="/api/v1/admin",     tags=["Admin"])
app.include_router(ai_admin.router,      prefix="/api/v1/admin/ai",  tags=["AI Admin"])
app.include_router(app_logs.router,      prefix="/api/v1/admin",     tags=["Application Logs"])
app.include_router(preset_router.router, prefix="/api/v1/debug",     tags=["Debug"])
app.include_router(catalog.router, prefix="/api/v1/catalog", tags=["Catalog"])
app.include_router(workbench.router, prefix="/api/v1/workbench", tags=["Workbench"])
app.include_router(workbench_mail.router, prefix="/api/v1/workbench/mail", tags=["Workbench Mail"])


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "version": APP_VERSION}
