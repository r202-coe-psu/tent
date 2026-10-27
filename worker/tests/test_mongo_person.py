"""Tests for `sync_booking_stay` — EXT-009 stay status of a booked evacuee (PDPA D8)."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model import ExternalBooking

from worker.mongo.person import sync_booking_stay

_CREATED = datetime(2026, 8, 20, 7, 30, tzinfo=UTC)


async def _written_row(row_id: str = "BP-1", evacuee_id: str = "evacuee:BP-1") -> None:
    await ExternalBooking(
        id=row_id,
        booking_id="BK-1",
        client_id="m2-test",
        shelter_code="SH001",
        cid_hash="hash",
        state="written",
        evacuee_id=evacuee_id,
        created_at=_CREATED,
        updated_at=_CREATED,
    ).insert()


async def test_sync_booking_stay_sets_status_without_touching_updated_at(
    db: None,
) -> None:
    await _written_row()

    await sync_booking_stay(
        {
            "_id": "evacuee:BP-1",
            "type": "evacuee",
            "booking_ref": "BK-1",
            "privacy": {"search_excluded": True},
            "current_stay": {"status": "active"},
        }
    )

    raw = await ExternalBooking.get_pymongo_collection().find_one({"_id": "BP-1"})
    assert raw is not None
    assert raw["stay_status"] == "active"
    # EXT-009 cancel uses `updated_at` as its flag marker — the worker must not move it.
    assert raw["updated_at"].replace(tzinfo=UTC) == _CREATED


async def test_sync_booking_stay_ignores_evacuees_without_booking_ref(db: None) -> None:
    await _written_row()

    await sync_booking_stay(
        {"_id": "evacuee:BP-1", "type": "evacuee", "current_stay": {"status": "active"}}
    )

    raw = await ExternalBooking.get_pymongo_collection().find_one({"_id": "BP-1"})
    assert raw is not None
    assert raw.get("stay_status") is None
