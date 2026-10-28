from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", hide_input_in_errors=True
    )
    database_url: str
    app_master_key: str = Field(min_length=32, repr=False)
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    storage_dir: str = "/app/data"
    storage_max_file_mb: int = 2048
    storage_reserve_mb: int = 256
    max_file_size_mb: int = 50
    environment: str = "development"
    log_dir: str = "/app/logs"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"


settings = Settings()
