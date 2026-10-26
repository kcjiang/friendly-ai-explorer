import logging
import os

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.ai.provider_client import AIError
from app.config import settings
from app.exception_handlers import (
    ai_error_handler,
    http_error_handler,
    validation_error_handler,
)
from app.i18n import LanguageMiddleware
from app.logging_config import configure_logging, log_event
from app.middleware.request_logging import RequestLoggingMiddleware
from app.routers import (
    admin,
    ai,
    ai_admin,
    app_logs,
    auth,
    catalog,
    knowledge,
    presets,
    tickets,
    users,
    workbench,
    workbench_mail,
)
from app.version import APP_VERSION

configure_logging()
log_event(logging.INFO, "后端应用已加载", version=APP_VERSION)

app = FastAPI(
    title="Friendly AI Explorer API",
    version=APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)


app.add_exception_handler(AIError, ai_error_handler)
app.add_exception_handler(StarletteHTTPException, http_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)

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

app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(tickets.router, prefix="/api/v1/tickets", tags=["Tickets"])
app.include_router(knowledge.router, prefix="/api/v1/knowledge", tags=["Knowledge"])
app.include_router(ai.router, prefix="/api/v1/ai", tags=["AI"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])
app.include_router(ai_admin.router, prefix="/api/v1/admin/ai", tags=["AI Admin"])
app.include_router(app_logs.router, prefix="/api/v1/admin", tags=["Application Logs"])
app.include_router(presets.router, prefix="/api/v1/debug", tags=["Debug"])
app.include_router(catalog.router, prefix="/api/v1/catalog", tags=["Catalog"])
app.include_router(workbench.router, prefix="/api/v1/workbench", tags=["Workbench"])
app.include_router(
    workbench_mail.router, prefix="/api/v1/workbench/mail", tags=["Workbench Mail"]
)


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "version": APP_VERSION}
