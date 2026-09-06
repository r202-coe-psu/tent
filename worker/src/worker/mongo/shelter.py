"""Write projected shelter documents to MongoDB."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from tent_model import OccupancyBreakdown, PublicShelter

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.mongo.upsert import apply_document
from worker.projectors.occupancy import aggregate_occupancy


async def apply_shelter(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(PublicShelter, action, payload)


async def apply_shelter_deactivate(shelter_code: str) -> None:
    """True CouchDB delete/archive signal — flip `is_active` False, never hard-delete
    the row (partner ODT "Soft Delete": M6 keeps referencing the location historically)."""
    existing = await PublicShelter.get(shelter_code)
    if existing is not None and existing.is_active:
        existing.is_active = False
        await existing.save()


async def refresh_occupancy(couch: CouchClient, shelter_code: str) -> bool:
    """Recompute `occupancy_total` / `occupancy_breakdown` from this shelter's active
    evacuees (EXT-005, ADR 0002 §2). No-op when the shelter has no `public_shelters`
    row yet — the `shelter` doc projection (`project_shelter`) owns creating it."""
    existing = await PublicShelter.get(shelter_code)
    if existing is None:
        return False

    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        return False

    evacuees = [
        doc
        async for doc in couch.iter_all_docs(database)
        if doc.get("type") == "evacuee"
        and str(doc.get("_id", "")).startswith("evacuee:")
    ]
    total, breakdown = aggregate_occupancy(evacuees)

    existing.occupancy_total = total
    existing.occupancy_breakdown = OccupancyBreakdown(**breakdown)
    existing.updated_at = datetime.now(UTC)
    await existing.save()
    return True
