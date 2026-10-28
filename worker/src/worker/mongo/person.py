"""Write projected person documents to MongoDB."""

from __future__ import annotations

from typing import Any

from tent_model import ExternalBooking, PublicPerson

from worker.mongo.upsert import apply_document


async def apply_person(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(PublicPerson, action, payload)


async def is_person_projected(person_id: str) -> bool:
    return await PublicPerson.get(person_id) is not None


async def delete_persons_for_shelter(shelter_code: str) -> None:
    await PublicPerson.find(PublicPerson.shelter_code == shelter_code).delete()


async def sync_booking_stay(doc: dict[str, Any]) -> None:
    """Copy a booked evacuee's stay status onto its `external_bookings` row (PDPA D8).

    EXT-009 cancel reads the stay from `public_persons`, which has no row for a
    search-excluded evacuee; it falls back to this. Only `stay_status` is set — the API
    uses `updated_at` as its cancel-flag marker, so it must not move.
    """
    booking_ref = doc.get("booking_ref")
    doc_id = doc.get("_id")
    if not booking_ref or not doc_id:
        return
    status = (doc.get("current_stay") or {}).get("status")
    await ExternalBooking.get_pymongo_collection().update_many(
        {"booking_id": booking_ref, "evacuee_id": doc_id},
        {"$set": {"stay_status": status}},
    )
