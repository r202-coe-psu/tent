"""One-shot bootstrap: project existing CouchDB docs into MongoDB."""

from __future__ import annotations

import logging
from typing import Any

from worker.couch.checkpoint import save_checkpoint
from worker.couch.client import CouchClient
from worker.masking import shelter_code_from_db_name, shelter_db_name
from worker.mongo import (
    apply_donation,
    apply_job,
    apply_job_application,
    apply_need,
    apply_need_counters,
    apply_person,
    apply_shelter,
    apply_shift_assignment,
    delete_needs_for_shelter,
    delete_persons_for_shelter,
)
from worker.mongo.on_hand import refresh_on_hand
from worker.projectors.donation import project_donation
from worker.projectors.donation_need_counter import plan_need_counters
from worker.projectors.evacuee import project_evacuee
from worker.projectors.job import project_job, project_job_application
from worker.projectors.needs import project_needs_for_shelter
from worker.projectors.shelter import is_shelter_open, project_shelter
from worker.projectors.shift_assignment import project_shift_assignment

logger = logging.getLogger(__name__)

REGISTRY_DB = "registry"


async def _load_households(
    couch: CouchClient, database: str
) -> dict[str, dict[str, Any]]:
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
            doc_type = doc.get("type")
            if doc_type == "shelter":
                action, payload = project_shelter(doc)
                await apply_shelter(action, payload)
                if action == "delete" and payload and payload.get("_id"):
                    code = str(payload["_id"])
                    await delete_persons_for_shelter(code)
                    await delete_needs_for_shelter(code)
            elif doc_type == "announcement":
                from worker.mongo.announcement import apply_announcement
                from worker.projectors.announcement import project_announcement

                action, payload = project_announcement(doc)
                await apply_announcement(action, payload)
            elif doc_type == "config":
                from worker.mongo.config import apply_config
                from worker.projectors.config import project_config

                action, payload = project_config(doc)
                await apply_config(action, payload)
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
        elif doc_type == "donation_campaign":
            # Bootstrap has to seed counters too, not just the CDC path (CR-060). A
            # freshly provisioned environment — first deploy, or a DR restore — runs
            # bootstrap and then tails _changes from the checkpoint it just saved, so
            # campaigns that already existed never arrive as change events. Without
            # this the counters stay empty and reserve_quota falls open: the system
            # looks healthy while enforcing no ceiling at all.
            await apply_need_counters(plan_need_counters(doc, shelter_code=shelter_code))
        elif doc_type == "job":
            # Same reason as the counters below: a job posted before this worker first
            # ran never arrives as a change event, and an unseeded VolunteerJobSlot
            # makes reserve_job_slot answer NOT_SEEDED for a job that is genuinely open.
            action, payload = project_job(doc, shelter_code=shelter_code)
            await apply_job(action, payload)
        elif doc_type == "job_application":
            action, payload = project_job_application(doc, shelter_code=shelter_code)
            await apply_job_application(action, payload)
        elif doc_type == "shift_assignment":
            volunteer_id = doc.get("volunteer_id")
            volunteer = await couch.get_doc(database, str(volunteer_id)) if volunteer_id else None
            action, payload = project_shift_assignment(
                doc, shelter_code=shelter_code, volunteer=volunteer
            )
            await apply_shift_assignment(action, payload)

    # Same reason the counters are seeded above: the ledger entries already on disk
    # never arrive as change events, and a counter left at on_hand_qty 0 enforces the
    # bare target instead of what is genuinely still needed.
    await refresh_on_hand(couch, shelter_code)

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


async def list_all_shelter_codes(couch: CouchClient) -> list[str]:
    """Every shelter in the registry, open or not.

    Sweeps that must not skip closed shelters use this — a closed shelter can still
    hold donations with a live reservation that needs expiring.
    """
    if not await couch.database_exists(REGISTRY_DB):
        return []
    codes: list[str] = []
    async for doc in couch.iter_all_docs(REGISTRY_DB):
        if doc.get("type") != "shelter":
            continue
        code = doc.get("code")
        if code:
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
