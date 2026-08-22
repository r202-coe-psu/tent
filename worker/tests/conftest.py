"""Shared fixtures for worker tests that need a live Mongo/Beanie connection."""

from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import PyMongoError
from tent_model import close_db, init_db
from tent_model.db import ALL_DOCUMENTS

TEST_DATABASE_URI = "mongodb://localhost:27017/tentdb_worker_test"


@pytest.fixture
async def db() -> AsyncGenerator[None, None]:
	"""Init Beanie against a test-only Mongo database and clean it up after."""
	db_name = TEST_DATABASE_URI.rsplit("/", 1)[-1]
	if "test" not in db_name:
		pytest.skip("Refusing to run against a non-test database name.")

	client = AsyncIOMotorClient(TEST_DATABASE_URI, serverSelectionTimeoutMS=1000)
	try:
		await client.admin.command("ping")
	except PyMongoError as exc:
		client.close()
		pytest.skip(f"MongoDB test database is not reachable: {exc}")

	await init_db(TEST_DATABASE_URI)
	try:
		yield
	finally:
		for model in ALL_DOCUMENTS:
			await client[db_name][model.Settings.name].delete_many({})
		client.close()
		await close_db()
