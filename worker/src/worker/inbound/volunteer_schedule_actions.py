"""Apply volunteer-owned schedule actions to shelter CouchDB documents."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from tent_model.volunteer_schedule_action_buffer import VolunteerScheduleActionBuffer

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 3


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


async def _apply_action(
    couch: CouchClient, action: VolunteerScheduleActionBuffer
) -> bool:
    database = shelter_db_name(action.shelter_code)
    doc = await couch.get_doc(database, action.assignment_id)
    if doc is None:
        logger.warning(
            "Schedule assignment %s is gone — dropping action", action.assignment_id
        )
        action.synced_to_couch = True
        await action.save()
        return True

    now = _iso(action.requested_at)
    if action.action == "check_in":
        doc["status"] = "checked_in"
        doc["check_in_at"] = now
        doc["check_in_by"] = "volunteer_portal"
        doc["check_in_method"] = "portal"
        doc["check_in_reason"] = None
    elif action.action == "check_out":
        doc["status"] = "completed"
        doc["check_out_at"] = now
        doc["check_out_by"] = "volunteer_portal"
        doc["check_out_method"] = "portal"
        doc["check_out_reason"] = None
    else:
        doc["status"] = "cancelled"
    doc["updated_at"] = now

    try:
        result = await couch.put_doc(database, doc)
    except Exception:
        logger.exception("Failed to apply volunteer schedule action %s", action.id)
        return False
    if not result.get("ok"):
        logger.warning(
            "CouchDB rejected volunteer schedule action %s: %s", action.id, result
        )
        return False

    # Keep the profile flag aligned with the same transition used by the staff flow.
    # A missing profile is harmless: the assignment itself remains the source of truth
    # for the next projection and the action must not be retried forever.
    if action.action in {"check_in", "check_out"}:
        volunteer = await couch.get_doc(database, action.volunteer_id)
        if volunteer is not None and volunteer.get("type") == "volunteer":
            volunteer["checked_in"] = action.action == "check_in"
            volunteer["current_shelter_code"] = (
                action.shelter_code if action.action == "check_in" else None
            )
            volunteer["updated_at"] = now
            try:
                profile_result = await couch.put_doc(database, volunteer)
            except Exception:
                logger.exception(
                    "Failed to update volunteer attendance %s", action.volunteer_id
                )
                return False
            if not profile_result.get("ok"):
                logger.warning(
                    "CouchDB rejected volunteer attendance update %s: %s",
                    action.volunteer_id,
                    profile_result,
                )
                return False

    action.synced_to_couch = True
    await action.save()
    logger.info("Applied volunteer schedule action %s", action.id)
    return True


async def run_volunteer_schedule_action_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    while not stop_event.is_set():
        try:
            pending = await VolunteerScheduleActionBuffer.find(
                VolunteerScheduleActionBuffer.synced_to_couch == False
            ).to_list()
            for action in pending:
                if stop_event.is_set():
                    break
                await _apply_action(couch, action)
        except Exception:
            logger.exception("Inbound volunteer schedule action poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
