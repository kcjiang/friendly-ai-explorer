from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", hide_input_in_errors=True
    )
    database_url: str
    app_master_key: str = Field(min_length=32, repr=False)
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    upload_dir: str = "/app/uploads"
    max_file_size_mb: int = 50
    environment: str = "development"
    log_dir: str = "/app/logs"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"


settings = Settings()
