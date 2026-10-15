import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from app.ai.provider_client import AIError

from app.config import settings
from app.logging_config import configure_logging, log_event, request_id_context
from app.middleware.request_logging import RequestLoggingMiddleware
import logging
from app.version import APP_VERSION
from app.routers import auth, tickets, knowledge, ai, admin, users, email_router, preset_router, catalog, ai_admin, app_logs

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
    return JSONResponse(status_code=502, content={"detail": str(exc), "request_id": request_id_context.get()})

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
app.include_router(email_router.router,  prefix="/api/v1/email",     tags=["Email"])
app.include_router(preset_router.router, prefix="/api/v1/debug",     tags=["Debug"])
app.include_router(catalog.router, prefix="/api/v1/catalog", tags=["Catalog"])


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "version": APP_VERSION}
