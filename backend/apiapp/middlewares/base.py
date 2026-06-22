from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ..core.config import Settings

def init_all_middlewares(app: FastAPI, settings: Settings) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOW_HOSTS,
        allow_credentials=settings.ALLOW_CREDENTIALS,
        allow_methods=settings.ALLOW_METHODS,
        allow_headers=settings.ALLOW_HEADERS,
    )
