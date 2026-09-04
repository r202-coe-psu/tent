"""Write projected shelter documents to MongoDB."""

from __future__ import annotations

from typing import Any

from tent_model import PublicShelter

from worker.mongo.upsert import apply_document


async def apply_shelter(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(PublicShelter, action, payload)


async def apply_shelter_deactivate(shelter_code: str) -> None:
    """True CouchDB delete/archive signal — flip `is_active` False, never hard-delete
    the row (partner ODT "Soft Delete": M6 keeps referencing the location historically)."""
    existing = await PublicShelter.get(shelter_code)
    if existing is not None and existing.is_active:
        existing.is_active = False
        await existing.save()
