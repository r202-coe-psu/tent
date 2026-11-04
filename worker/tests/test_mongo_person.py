"""Tests for `sync_booking_stay` — EXT-009 stay status of a booked evacuee (PDPA D8)."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model import ExternalBooking, PublicPerson

from worker.mongo.person import apply_person, sync_booking_stay
from worker.projectors.evacuee import project_evacuee

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


async def test_hiding_a_projected_person_removes_the_public_row(db: None) -> None:
    doc = {
        "_id": "evacuee:01HIDE",
        "type": "evacuee",
        "first_name": "สมชาย",
        "last_name": "ใจดี",
        "privacy": {"search_excluded": False},
        "current_stay": {"status": "active"},
        "updated_at": "2026-10-30T04:00:00.000Z",
    }
    await apply_person(*project_evacuee(doc, shelter_code="SH001"))
    assert await PublicPerson.get("evacuee:01HIDE") is not None

    hidden = {**doc, "privacy": {"search_excluded": True}}
    await apply_person(*project_evacuee(hidden, shelter_code="SH001"))
    assert await PublicPerson.get("evacuee:01HIDE") is None

    await apply_person(*project_evacuee(doc, shelter_code="SH001"))
    assert await PublicPerson.get("evacuee:01HIDE") is not None
