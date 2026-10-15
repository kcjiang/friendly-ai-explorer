# ============================================================
#  文件 1：backend/app/config.py
# ============================================================
from pydantic_settings import BaseSettings
from typing import Literal

class Settings(BaseSettings):
    database_url: str
    google_api_key: str = ""
    ai_encryption_key: str = ""
    embedding_model: str = "gemini-embedding-001"
    jwt_secret_key: str = "friendly-ai-explorer-jwt-secret-2024"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    upload_dir: str = "/app/uploads"
    max_file_size_mb: int = 50
    environment: str = "development"
    log_dir: str = "/app/logs"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
