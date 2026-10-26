"""Write projected shelter documents to MongoDB."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from tent_model import OccupancyBreakdown, PublicShelter

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.mongo.upsert import apply_document
from worker.projectors.occupancy import aggregate_occupancy, count_stay_statuses


async def apply_shelter(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(PublicShelter, action, payload)


async def apply_shelter_deactivate(shelter_code: str) -> None:
    """True CouchDB delete/archive signal — flip `is_active` False, never hard-delete
    the row (partner ODT "Soft Delete": M6 keeps referencing the location historically)."""
    existing = await PublicShelter.get(shelter_code)
    if existing is not None and existing.is_active:
        existing.is_active = False
        await existing.save()


async def is_shelter_projected(shelter_code: str) -> bool:
    """Whether `public_shelters` holds a row for this code.

    A cancelled shelter has none (its projection is purged), so shelter-DB changes for
    it are skipped until the status is reverted and the registry re-projects it."""
    return await PublicShelter.get(shelter_code) is not None


async def refresh_occupancy(couch: CouchClient, shelter_code: str) -> bool:
    """Recompute `occupancy_total` / `occupancy_breakdown` from this shelter's active
    evacuees (EXT-005, ADR 0002 §2) and `occupancy_by_status` from all of them (PDPA D8).
    No-op when the shelter has no `public_shelters`
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
    existing.occupancy_by_status = count_stay_statuses(evacuees)
    existing.updated_at = datetime.now(UTC)
    await existing.save()
    return True
