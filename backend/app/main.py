import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.version import APP_VERSION
from app.routers import auth, tickets, knowledge, ai, admin, users, email_router, preset_router

app = FastAPI(
    title="Friendly AI Explorer API",
    version=APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

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

os.makedirs(settings.upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")

app.include_router(auth.router,          prefix="/api/v1/auth",      tags=["Auth"])
app.include_router(users.router,         prefix="/api/v1/users",     tags=["Users"])
app.include_router(tickets.router,       prefix="/api/v1/tickets",   tags=["Tickets"])
app.include_router(knowledge.router,     prefix="/api/v1/knowledge", tags=["Knowledge"])
app.include_router(ai.router,            prefix="/api/v1/ai",        tags=["AI"])
app.include_router(admin.router,         prefix="/api/v1/admin",     tags=["Admin"])
app.include_router(email_router.router,  prefix="/api/v1/email",     tags=["Email"])
app.include_router(preset_router.router, prefix="/api/v1/debug",     tags=["Debug"])


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "version": APP_VERSION}
