"""Write projected shelter occupant documents to MongoDB (EXT-007)."""

from __future__ import annotations

from typing import Any

from tent_model import ShelterOccupant

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.mongo.upsert import apply_document
from worker.projectors.occupant import project_shelter_occupant


async def apply_shelter_occupant(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(ShelterOccupant, action, payload)


async def delete_occupants_for_shelter(shelter_code: str) -> int:
    result = await ShelterOccupant.find({"shelter_code": shelter_code}).delete()
    return result.deleted_count if result else 0


async def refresh_shelter_occupants(couch: CouchClient, shelter_code: str) -> int:
    """Recompute active `shelter_occupants` rows for one shelter from its evacuee docs.

    Only active evacuees are retained. Checked-out or inactive evacuees are purged.
    """
    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        await delete_occupants_for_shelter(shelter_code)
        return 0

    active_payloads: list[dict[str, Any]] = []
    async for doc in couch.iter_all_docs(database):
        if doc.get("type") == "evacuee" and str(doc.get("_id", "")).startswith(
            "evacuee:"
        ):
            payload = project_shelter_occupant(doc, shelter_code)
            if payload is not None:
                active_payloads.append(payload)

    active_ids = {p["_id"] for p in active_payloads}

    # Remove occupants who are no longer active in this shelter
    existing = await ShelterOccupant.find({"shelter_code": shelter_code}).to_list()
    for row in existing:
        if row.id not in active_ids:
            await row.delete()

    # Upsert current active occupants
    for payload in active_payloads:
        await apply_shelter_occupant("upsert", payload)

    return len(active_payloads)
