from fastapi import FastAPI
from fastapi.exceptions import HTTPException, RequestValidationError
from contextlib import asynccontextmanager
from loguru import logger
from .core.config import get_settings
from .core import http_error, validation_error
from .core.router import init_routers
from .middlewares.base import init_all_middlewares
from .infrastructure.database import init_mongodb, close_mongodb

def create_app() -> FastAPI:
    settings = get_settings()
    settings.configure_logging()

    app = FastAPI(lifespan=lifespan, **settings.fastapi_kwargs)
    
    app.add_exception_handler(HTTPException, http_error.http_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error.http422_error_handler)
    
    init_all_middlewares(app, settings=settings)
    app.router.lifespan_context = lifespan

    return app

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await init_mongodb(settings)
    
    init_routers(app, settings)
    yield
    await close_mongodb()
