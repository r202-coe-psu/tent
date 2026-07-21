"""Process a single CouchDB change row into MongoDB."""

from __future__ import annotations

import logging
from typing import Any

from worker.couch.checkpoint import save_checkpoint
from worker.masking import shelter_code_from_db_name, shelter_db_name
from worker.mongo import (
    apply_donation,
    apply_need,
    apply_person,
    apply_shelter,
    delete_needs_for_shelter,
    delete_persons_for_shelter,
    resolve_shelter_code_for_registry_delete,
)
from worker.projectors.donation import project_donation
from worker.projectors.evacuee import project_evacuee
from worker.projectors.needs import project_needs_for_shelter
from worker.projectors.shelter import project_shelter

logger = logging.getLogger(__name__)

REGISTRY_DB = "registry"


async def process_change(couch: Any, database: str, change: dict[str, Any]) -> None:
    seq = change.get("seq")
    if seq is None:
        return

    if change.get("deleted"):
        doc_id = change.get("id")
        if not doc_id:
            await save_checkpoint(database, seq)
            return
        if database == REGISTRY_DB:
            deleted_doc = change.get("doc")
            shelter_code = await resolve_shelter_code_for_registry_delete(
                doc_id, deleted_doc=deleted_doc
            )
            if shelter_code:
                await apply_shelter("delete", {"_id": shelter_code})
                await delete_persons_for_shelter(shelter_code)
                await delete_needs_for_shelter(shelter_code)
        else:
            shelter_code = shelter_code_from_db_name(database)
            if shelter_code:
                await apply_person("delete", {"_id": doc_id})
                if doc_id.startswith("donation:"):
                    await apply_donation("delete", {"_id": doc_id})
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
            code = str(payload["_id"])
            await delete_persons_for_shelter(code)
            await delete_needs_for_shelter(code)
    else:
        shelter_code = shelter_code_from_db_name(database)
        if shelter_code:
            doc_type = doc.get("type")
            if doc_type == "evacuee":
                household = None
                household_id = doc.get("household_id")
                if household_id:
                    household = await couch.get_doc(database, str(household_id))
                action, payload = project_evacuee(
                    doc, shelter_code=shelter_code, household=household
                )
                await apply_person(action, payload)
            elif doc_type == "donation":
                action, payload = project_donation(doc, shelter_code=shelter_code)
                await apply_donation(action, payload)
            elif doc_type in {"donation_campaign", "supply_item"}:
                need_actions = await project_needs_for_shelter(couch, shelter_code)
                for action, payload in need_actions:
                    await apply_need(action, payload)

    await save_checkpoint(database, seq)
