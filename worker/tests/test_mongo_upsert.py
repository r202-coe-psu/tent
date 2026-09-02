"""Tests for the shared projection writer."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.mongo.upsert import apply_document


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("action", "payload"),
    [("ignore", {}), ("ignore", None), ("upsert", {}), ("upsert", None)],
)
async def test_nothing_to_write_is_not_an_error(action: str, payload: dict | None):
    """A projector that ignored a document hands back an empty payload, not None.

    Reading `_id` off it raised KeyError and took the whole bootstrap scan down with it,
    leaving Mongo half-filled on a fresh deploy — every collection after the offending
    document simply never got written.
    """
    model = MagicMock()
    model.get = AsyncMock()

    await apply_document(model, action, payload)

    model.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_delete_without_an_id_is_a_no_op():
    model = MagicMock()
    model.get = AsyncMock()

    await apply_document(model, "delete", {})

    model.get.assert_not_awaited()
