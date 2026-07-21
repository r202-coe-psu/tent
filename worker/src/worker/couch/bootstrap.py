"""One-shot bootstrap: project existing CouchDB docs into MongoDB."""

from __future__ import annotations

import logging
from typing import Any

from worker.couch.checkpoint import save_checkpoint
from worker.couch.client import CouchClient
from worker.masking import shelter_code_from_db_name, shelter_db_name
from worker.mongo import (
    apply_donation,
    apply_need,
    apply_person,
    apply_shelter,
    delete_needs_for_shelter,
    delete_persons_for_shelter,
)
from worker.projectors.donation import project_donation
from worker.projectors.evacuee import project_evacuee
from worker.projectors.needs import project_needs_for_shelter
from worker.projectors.shelter import is_shelter_open, project_shelter

logger = logging.getLogger(__name__)

REGISTRY_DB = "registry"


async def _load_households(couch: CouchClient, database: str) -> dict[str, dict[str, Any]]:
    households: dict[str, dict[str, Any]] = {}
    async for doc in couch.iter_all_docs(database):
        if doc.get("type") == "household" and doc.get("_id"):
            households[str(doc["_id"])] = doc
    return households


async def bootstrap_database(couch: CouchClient, database: str) -> None:
    if not await couch.database_exists(database):
        logger.warning("Database %s does not exist — skipping bootstrap", database)
        return

    shelter_code = shelter_code_from_db_name(database)
    if database == REGISTRY_DB:
        async for doc in couch.iter_all_docs(REGISTRY_DB):
            action, payload = project_shelter(doc)
            await apply_shelter(action, payload)
            if action == "delete" and payload and payload.get("_id"):
                code = str(payload["_id"])
                await delete_persons_for_shelter(code)
                await delete_needs_for_shelter(code)
        seq = await couch.db_update_seq(REGISTRY_DB)
        await save_checkpoint(REGISTRY_DB, seq)
        logger.info("Bootstrap complete for %s (seq=%s)", REGISTRY_DB, seq)
        return

    if shelter_code is None:
        return

    households = await _load_households(couch, database)

    async for doc in couch.iter_all_docs(database):
        doc_type = doc.get("type")
        if doc_type == "evacuee":
            household_id = doc.get("household_id")
            household = households.get(household_id) if household_id else None
            action, payload = project_evacuee(
                doc, shelter_code=shelter_code, household=household
            )
            await apply_person(action, payload)
        elif doc_type == "donation":
            action, payload = project_donation(doc, shelter_code=shelter_code)
            await apply_donation(action, payload)

    need_actions = await project_needs_for_shelter(couch, shelter_code)
    for action, payload in need_actions:
        await apply_need(action, payload)

    seq = await couch.db_update_seq(database)
    await save_checkpoint(database, seq)
    logger.info("Bootstrap complete for %s (seq=%s)", database, seq)


async def list_open_shelter_codes(couch: CouchClient) -> list[str]:
    if not await couch.database_exists(REGISTRY_DB):
        return []
    codes: list[str] = []
    async for doc in couch.iter_all_docs(REGISTRY_DB):
        if doc.get("type") != "shelter":
            continue
        code = doc.get("code")
        if code and is_shelter_open(doc):
            codes.append(str(code))
    return sorted(set(codes))


async def bootstrap_all(couch: CouchClient) -> None:
    logger.info("Starting bootstrap scan")
    await bootstrap_database(couch, REGISTRY_DB)
    for code in await list_open_shelter_codes(couch):
        await bootstrap_database(couch, shelter_db_name(code))
    logger.info("Bootstrap finished")


async def needs_bootstrap() -> bool:
    from worker.couch.checkpoint import get_checkpoint

    registry_cp = await get_checkpoint(REGISTRY_DB)
    return registry_cp is None
