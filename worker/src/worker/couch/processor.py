"""Process a single CouchDB change row into MongoDB."""

from __future__ import annotations

import logging
from typing import Any

from worker.couch.checkpoint import save_checkpoint
from worker.masking import shelter_code_from_db_name
from worker.mongo import apply_person, apply_shelter, delete_persons_for_shelter
from worker.projectors.evacuee import project_evacuee
from worker.projectors.shelter import project_shelter

logger = logging.getLogger(__name__)

REGISTRY_DB = "registry"


async def process_change(database: str, change: dict[str, Any]) -> None:
    seq = change.get("seq")
    if seq is None:
        return

    if change.get("deleted"):
        doc_id = change.get("id")
        if not doc_id:
            await save_checkpoint(database, seq)
            return
        if database == REGISTRY_DB:
            await apply_shelter("delete", {"_id": _shelter_code_from_deleted_id(doc_id)})
        else:
            shelter_code = shelter_code_from_db_name(database)
            if shelter_code:
                await apply_person("delete", {"_id": doc_id})
        await save_checkpoint(database, seq)
        return

    doc = change.get("doc")
    if not doc:
        await save_checkpoint(database, seq)
        return

    if database == REGISTRY_DB:
        action, payload = project_shelter(doc)
        await apply_shelter(action, payload)
        if action == "delete" and payload and payload.get("_id"):
            await delete_persons_for_shelter(payload["_id"])
    else:
        shelter_code = shelter_code_from_db_name(database)
        if shelter_code:
            action, payload = project_evacuee(doc, shelter_code=shelter_code)
            await apply_person(action, payload)

    await save_checkpoint(database, seq)


def _shelter_code_from_deleted_id(doc_id: str) -> str:
    # Registry shelter docs use shelter:{ulid} — on delete we cannot resolve code
    # from id alone; tombstone without doc means remove by scanning is not possible.
    # Return doc_id as fallback (usually won't match public_shelters _id).
    return doc_id
