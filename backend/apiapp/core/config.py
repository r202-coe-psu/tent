import logging
import sys
from typing import Any, Dict, List, Tuple
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
import os
from pathlib import Path
from loguru import logger
from ..utils.logging import InterceptHandler

ENV: str = os.getenv("APP_ENV", "")
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    APP_ENV: str = ENV
    DEBUG: bool = False
    DOCS_URL: str = "/docs"
    OPENAPI_PREFIX: str = ""
    OPENAPI_URL: str = "/openapi.json"
    REDOC_URL: str = "/redoc"
    TITLE: str = "Smart Shelter Backend API"
    VERSION: str = "1.0.0"

    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "smart_shelter"

    API_PREFIX: str = ""

    # CORS
    ALLOW_CREDENTIALS: bool = True
    ALLOW_HOSTS: List[str] = ["*"]
    ALLOW_METHODS: List[str] = ["*"]
    ALLOW_HEADERS: List[str] = ["*"]

    LOGGING_LEVEL: int = logging.INFO
    LOGGERS: Tuple[str, str] = ("uvicorn.asgi", "uvicorn.access")

    model_config = SettingsConfigDict(
        case_sensitive=True,
        env_file=(
            PROJECT_ROOT / ".env.prod"
            if "prod" == ENV
            else PROJECT_ROOT / ".env.test"
            if "test" == ENV
            else PROJECT_ROOT / ".env"
        ),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def fastapi_kwargs(self) -> Dict[str, Any]:
        return {
            "debug": self.DEBUG,
            "docs_url": self.DOCS_URL,
            "openapi_prefix": self.OPENAPI_PREFIX,
            "openapi_url": self.OPENAPI_URL,
            "redoc_url": self.REDOC_URL,
            "title": self.TITLE,
            "version": self.VERSION,
        }

    def configure_logging(self) -> None:
        logging.getLogger().handlers = [InterceptHandler()]
        for logger_name in self.LOGGERS:
            logging_logger = logging.getLogger(logger_name)
            logging_logger.handlers = [InterceptHandler(level=self.LOGGING_LEVEL)]

        logger.configure(handlers=[{"sink": sys.stderr, "level": self.LOGGING_LEVEL}])

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
