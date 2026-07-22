import logging
import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from loguru import logger
from pydantic_settings import BaseSettings, SettingsConfigDict

from ..utils.logging import InterceptHandler

ENV: str = os.getenv("APP_ENV", "")

# Get project root directory (go up 3 levels from config.py)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    # base
    APP_ENV: str = ENV
    DEBUG: bool = False
    REDIRECT_SLASHES: bool = True
    DOCS_URL: str = "/docs"
    OPENAPI_PREFIX: str = ""
    OPENAPI_URL: str = "/openapi.json"
    REDOC_URL: str = "/redoc"
    TITLE: str = "CouchDB Lab Public API"
    VERSION: str = "0.1.0"

    DATABASE_URI: str = ""
    EXTERNAL_API_SECRET: str = ""
    REDIS_URL: str = "redis://localhost:6379/0"

    # auth
    SECRET_KEY: str = "secret_key"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 30 * 24 * 60
    OTP_INTERVAL: int = 30

    API_PREFIX: str = ""

    # CORS
    ALLOW_CREDENTIALS: bool = True
    ALLOW_HOSTS: list[str] = ["*"]
    ALLOW_METHODS: list[str] = ["*"]
    ALLOW_HEADERS: list[str] = ["*"]
    DISALLOW_AGENTS: list[str] = [
        "zgrab",
        "wget",
    ]

    LOGGING_LEVEL: int = logging.INFO
    LOGGERS: tuple[str, str] = ("uvicorn.asgi", "uvicorn.access")

    # find query
    DEFAULT_PAGE_SIZE: int = 20
    # MAX_PAGE_SIZE: int = 100

    # date
    DATETIME_FORMAT: str = "%Y-%m-%dT%H:%M:%S"
    DATE_FORMAT: str = "%Y-%m-%d"
    DAILY_TIME_TO_RUN_QUEUE: str = "00:00"

    model_config = SettingsConfigDict(
        case_sensitive=True,
        env_file=(
            PROJECT_ROOT / ".env"
            if "dev" == ENV
            else PROJECT_ROOT / ".env.prod"
            if "prod" == ENV
            else PROJECT_ROOT / ".env.test"
        ),
        env_file_encoding="utf-8",
    )

    @property
    def fastapi_kwargs(self) -> dict[str, Any]:
        """FastAPI application configuration"""
        docs_url = None if self.APP_ENV == "prod" else self.DOCS_URL
        redoc_url = None if self.APP_ENV == "prod" else self.REDOC_URL
        openapi_url = None if self.APP_ENV == "prod" else self.OPENAPI_URL
        return {
            "debug": self.DEBUG,
            "docs_url": docs_url,
            "openapi_prefix": self.OPENAPI_PREFIX,
            "openapi_url": openapi_url,
            "redoc_url": redoc_url,
            "title": self.TITLE,
            "version": self.VERSION,
        }

    def configure_logging(self) -> None:
        """Configure application logging"""
        logging.getLogger().handlers = [InterceptHandler()]
        for logger_name in self.LOGGERS:
            logging_logger = logging.getLogger(logger_name)
            logging_logger.handlers = [InterceptHandler(level=self.LOGGING_LEVEL)]

        logger.configure(handlers=[{"sink": sys.stderr, "level": self.LOGGING_LEVEL}])


@lru_cache
def get_settings() -> Settings:
    """Get application settings (cached)"""
    return Settings()


# Export for backward compatibility and convenience
settings = get_settings()
