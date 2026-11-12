"""#1049: startup drops the legacy unique `uniq_open_phones` index."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from pymongo.errors import OperationFailure

from apiapp.core.config import Settings
from apiapp.infrastructure.database import BeanieClient, _database_name

COLLECTION = "unassigned_registrations"


async def test_init_drops_legacy_unique_index(settings: Settings, db_client):
    coll = db_client[_database_name(settings.DATABASE_URI)][COLLECTION]
    await coll.create_index(
        [("open_phones", 1)],
        name="uniq_open_phones",
        unique=True,
        partialFilterExpression={"open_phones": {"$exists": True}},
    )

    beanie_client = BeanieClient()
    try:
        await beanie_client.init_beanie(settings)
        names = {i["name"] async for i in await coll.list_indexes()}
    finally:
        await beanie_client.close()

    assert "uniq_open_phones" not in names
    assert "by_open_phones" in names


def _client_failing_with(code: int) -> BeanieClient:
    bc = BeanieClient()
    coll = MagicMock()
    coll.drop_index = AsyncMock(side_effect=OperationFailure("boom", code=code))
    bc.database = {COLLECTION: coll}
    return bc


async def test_drop_ignores_index_not_found():
    await _client_failing_with(27)._drop_legacy_unique_phone_index()


async def test_drop_reraises_other_failures():
    with pytest.raises(OperationFailure):
        await _client_failing_with(13)._drop_legacy_unique_phone_index()
