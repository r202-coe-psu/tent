from collections.abc import AsyncGenerator

import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import PyMongoError

from apiapp.core.config import Settings, get_settings
from apiapp.run import create_app


@pytest.fixture
def settings() -> Settings:
    """Load settings for tests."""
    settings = get_settings()
    if not settings.DATABASE_URI:
        settings.DATABASE_URI = "mongodb://localhost:27017/tentdb_test"
    if not settings.EXTERNAL_API_SECRET:
        settings.EXTERNAL_API_SECRET = "test-external-secret"
    return settings


@pytest.fixture
async def db_client(settings: Settings) -> AsyncGenerator[AsyncIOMotorClient, None]:
    """Create a MongoDB client bound to the current test event loop."""
    client = AsyncIOMotorClient(
        settings.DATABASE_URI,
        serverSelectionTimeoutMS=1000,
    )
    yield client
    client.close()


@pytest.fixture
async def app(settings: Settings) -> AsyncGenerator[FastAPI, None]:
    """Create a FastAPI application instance for a single test."""
    _app = create_app()
    async with LifespanManager(_app):
        yield _app


@pytest.fixture
async def client(app: FastAPI) -> AsyncGenerator[AsyncClient, None]:
    """Create a test client for the FastAPI application."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
async def clean_db(settings: Settings, db_client: AsyncIOMotorClient):
    """Clean the database before each test function."""
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    if "test" not in db_name and "test" not in settings.APP_ENV:
        pytest.skip("Running against a non-test database! Aborting.")

    db = db_client[db_name]
    try:
        collections = await db.list_collection_names()
    except PyMongoError as exc:
        pytest.skip(f"MongoDB test database is not reachable: {exc}")

    for collection in collections:
        await db[collection].delete_many({})

    yield
