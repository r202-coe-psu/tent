"""Process a single CouchDB change row into MongoDB."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from worker.couch.checkpoint import save_checkpoint
from worker.masking import shelter_code_from_db_name
from worker.mongo import (
    apply_donation,
    apply_job,
    apply_job_application,
    apply_need,
    apply_need_counters,
    apply_person,
    apply_shelter,
    apply_shift_assignment,
    apply_volunteer,
    delete_needs_for_shelter,
    delete_persons_for_shelter,
    resolve_shelter_code_for_registry_delete,
)
from worker.mongo.announcement import apply_announcement
from worker.mongo.on_hand import refresh_on_hand
from worker.projectors.announcement import project_announcement
from worker.projectors.donation import project_donation
from worker.projectors.donation_need_counter import plan_need_counters
from worker.projectors.evacuee import project_evacuee
from worker.projectors.job import project_job, project_job_application
from worker.projectors.needs import project_needs_for_shelter
from worker.projectors.shelter import project_shelter
from worker.projectors.shift_assignment import project_shift_assignment
from worker.projectors.volunteer import project_volunteer
from worker.quota.settle import reserve_walk_in_quota, settle_donation_quota

logger = logging.getLogger(__name__)

REGISTRY_DB = "registry"


async def _reproject_needs(couch: Any, shelter_code: str) -> None:
    """Recompute public_needs from open campaigns − donations for one shelter."""
    need_actions = await project_needs_for_shelter(couch, shelter_code)
    for action, payload in need_actions:
        await apply_need(action, payload)


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
            if doc_id.startswith("announcement:"):
                await apply_announcement("delete", {"_id": doc_id})
            elif doc_id.startswith("master_data:volunteer_skills"):
                # `master_data:volunteer_skills[:SHELTER]` → its projected config id.
                # Without this the public gate would keep enforcing a list that staff
                # deleted (CR-100).
                from worker.mongo.config import apply_config
                from worker.projectors.master_data import volunteer_skills_config_id

                suffix = doc_id.split("master_data:volunteer_skills", 1)[1].lstrip(":")
                await apply_config(
                    "delete", {"_id": volunteer_skills_config_id(suffix or None)}
                )
            else:
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
                    # Declared qty left the board — recompute remaining needs.
                    await _reproject_needs(couch, shelter_code)
                elif doc_id.startswith("job:"):
                    await apply_job("delete", {"_id": doc_id})
                elif doc_id.startswith("job_application:"):
                    await apply_job_application("delete", {"_id": doc_id})
                elif doc_id.startswith("shift_assignment:"):
                    await apply_shift_assignment("delete", {"_id": doc_id})
                elif doc_id.startswith("stock_ledger:"):
                    # A deleted entry raises the shortfall again, so the ceiling has to
                    # go back up with it — a delete row carries no doc to read a type
                    # from, hence the id prefix.
                    await refresh_on_hand(couch, shelter_code)
                    await _reproject_needs(couch, shelter_code)
        await save_checkpoint(database, seq)
        return

    doc = change.get("doc")
    if not doc:
        await save_checkpoint(database, seq)
        return

    if database == REGISTRY_DB:
        doc_type = doc.get("type")
        if doc_type == "shelter":
            action, payload = project_shelter(doc)
            await apply_shelter(action, payload)
            if action == "delete" and payload and payload.get("_id"):
                code = str(payload["_id"])
                await delete_persons_for_shelter(code)
                await delete_needs_for_shelter(code)
        elif doc_type == "announcement":
            action, payload = project_announcement(doc)
            await apply_announcement(action, payload)
        elif doc_type == "config":
            from worker.mongo.config import apply_config
            from worker.projectors.config import project_config

            action, payload = project_config(doc)
            await apply_config(action, payload)
        elif doc_type == "master_data":
            # Only the controlled-skill list crosses over (CR-100) — see the
            # projector's own doc for why it is an allow-list, not a copy.
            from worker.mongo.config import apply_config
            from worker.projectors.master_data import project_master_data

            action, payload = project_master_data(doc)
            await apply_config(action, payload)
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
                # A donation that left declared/received stops holding its reservation.
                # Driven off the CouchDB doc — the system of record — because the BFF
                # cancels there directly and never touches the Mongo buffer.
                now = datetime.now(UTC)
                await settle_donation_quota(doc, now=now)
                # …and one that arrived without ever reserving — a walk-in staff keyed
                # in — has to start holding it, or the counter hands the same goods out
                # to a public donor as well.
                await reserve_walk_in_quota(
                    couch, doc, shelter_code=shelter_code, now=now
                )
                # New/updated declared items change remaining qty on the public board.
                await _reproject_needs(couch, shelter_code)
            elif doc_type == "donation_campaign":
                # CR-060: seed the atomic quota ceiling FastAPI reserves against. The
                # campaign doc is already in hand from the change row — no re-fetch,
                # unlike the full re-scan _reproject_needs does.
                await apply_need_counters(
                    plan_need_counters(doc, shelter_code=shelter_code)
                )
                # A counter seeded now starts at on_hand_qty 0 even when the shelf is
                # already full, so give it the current balance before it takes bookings.
                await refresh_on_hand(couch, shelter_code)
                await _reproject_needs(couch, shelter_code)
            elif doc_type == "stock_ledger":
                # Goods on the shelf lower what a need still has to be donated, so they
                # lower the reservation ceiling too — the counter caps at
                # ``qty_target − on_hand_qty``. Nothing used to react to a ledger entry
                # at all: the board kept advertising the old shortfall and the counter
                # kept accepting bookings against the bare target.
                await refresh_on_hand(couch, shelter_code)
                await _reproject_needs(couch, shelter_code)
            elif doc_type == "job":
                action, payload = project_job(doc, shelter_code=shelter_code)
                await apply_job(action, payload)
            elif doc_type == "job_application":
                action, payload = project_job_application(
                    doc, shelter_code=shelter_code
                )
                await apply_job_application(action, payload)
            elif doc_type == "shift_assignment":
                # The assignee's profile is the only source of the phone hash the
                # portal looks a schedule up by, so it has to be read alongside.
                volunteer = None
                volunteer_id = doc.get("volunteer_id")
                if volunteer_id:
                    volunteer = await couch.get_doc(database, str(volunteer_id))
                action, payload = project_shift_assignment(
                    doc, shelter_code=shelter_code, volunteer=volunteer
                )
                await apply_shift_assignment(action, payload)
            elif doc_type == "volunteer":
                action, payload = project_volunteer(doc, shelter_code=shelter_code)
                await apply_volunteer(action, payload)
            elif doc_type == "supply_item":
                await _reproject_needs(couch, shelter_code)

    await save_checkpoint(database, seq)
