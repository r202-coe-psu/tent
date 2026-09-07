"""Tests for `apply_shelter_deactivate` — the true archive/delete signal handler.

Per the partner ODT (B_Data_We_Request_From_Partner_Systems, "Soft Delete"): a genuine
CouchDB delete/archive must never hard-delete the `public_shelters` row — only flip
`is_active` to `False`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

from tent_model import PublicShelter

from worker.mongo.shelter import apply_shelter_deactivate, refresh_occupancy


async def test_apply_shelter_deactivate_flips_flag_without_deleting_row(
    db: None,
) -> None:
    await PublicShelter(
        id="SH900",
        shelter_code="SH900",
        name="ศูนย์ที่ถูกยกเลิก",
        status="closed",
        is_active=True,
        capacity=10,
        updated_at=datetime.now(UTC),
    ).insert()

    await apply_shelter_deactivate("SH900")

    reloaded = await PublicShelter.get("SH900")
    assert reloaded is not None, "row must never be hard-deleted"
    assert reloaded.is_active is False


async def test_apply_shelter_deactivate_is_idempotent(db: None) -> None:
    await PublicShelter(
        id="SH901",
        shelter_code="SH901",
        name="ศูนย์ที่ถูกยกเลิกแล้ว",
        status="closed",
        is_active=False,
        capacity=10,
        updated_at=datetime.now(UTC),
    ).insert()

    await apply_shelter_deactivate("SH901")

    reloaded = await PublicShelter.get("SH901")
    assert reloaded is not None
    assert reloaded.is_active is False


async def test_apply_shelter_deactivate_no_op_when_shelter_unknown(db: None) -> None:
    # No matching document — must not raise.
    await apply_shelter_deactivate("SH-DOES-NOT-EXIST")


# --- EXT-005: refresh_occupancy ---


async def test_refresh_occupancy_writes_total_and_breakdown(db: None) -> None:
    await PublicShelter(
        id="SH910",
        shelter_code="SH910",
        name="ศูนย์ทดสอบ occupancy",
        status="open",
        is_active=True,
        capacity=100,
        updated_at=datetime.now(UTC),
    ).insert()

    async def _docs(_database: str):
        for doc in (
            {
                "_id": "evacuee:1",
                "type": "evacuee",
                "gender": "male",
                "age": 70,
                "current_stay": {"status": "active"},
            },
            {
                "_id": "evacuee:2",
                "type": "evacuee",
                "gender": "female",
                "current_stay": {"status": "checked_out"},
            },
        ):
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = _docs

    assert await refresh_occupancy(couch, "SH910") is True

    reloaded = await PublicShelter.get("SH910")
    assert reloaded is not None
    assert reloaded.occupancy_total == 1
    assert reloaded.occupancy_breakdown.male == 1
    assert reloaded.occupancy_breakdown.elderly_over_60 == 1
    assert reloaded.occupancy_breakdown.female == 0


async def test_refresh_occupancy_no_op_when_shelter_row_missing(db: None) -> None:
    couch = AsyncMock()
    assert await refresh_occupancy(couch, "SH-DOES-NOT-EXIST") is False
    couch.database_exists.assert_not_called()


async def test_refresh_occupancy_no_op_when_shelter_database_missing(db: None) -> None:
    await PublicShelter(
        id="SH911",
        shelter_code="SH911",
        name="ศูนย์ไม่มี database",
        status="open",
        is_active=True,
        capacity=10,
        updated_at=datetime.now(UTC),
    ).insert()

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=False)

    assert await refresh_occupancy(couch, "SH911") is False
