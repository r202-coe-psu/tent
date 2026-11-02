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


@pytest.mark.asyncio
async def test_need_prune_removes_stale_and_legacy_rows_of_that_shelter_only(db):
    """CR-206 A2 FR-AP-25a: rows not in keep_ids go (edited point, legacy id); other
    shelters are untouched."""
    from datetime import UTC, datetime

    from tent_model import PublicNeed

    from worker.mongo.need import apply_need

    def row(doc_id: str, shelter: str) -> PublicNeed:
        return PublicNeed(
            _id=doc_id,
            shelter_code=shelter,
            item_name="ข้าว",
            category="food",
            qty_needed=1.0,
            unit="kg",
            updated_at=datetime.now(UTC),
        )

    for doc_id, shelter in [
        ("SH001:item:rice@hall", "SH001"),
        ("SH001:item:rice@gym", "SH001"),
        ("SH001:item:rice", "SH001"),
        ("SH002:item:rice@-", "SH002"),
    ]:
        await row(doc_id, shelter).insert()

    await apply_need(
        "prune", {"shelter_code": "SH001", "keep_ids": ["SH001:item:rice@hall"]}
    )

    ids = {n.id for n in await PublicNeed.find_all().to_list()}
    assert ids == {"SH001:item:rice@hall", "SH002:item:rice@-"}
