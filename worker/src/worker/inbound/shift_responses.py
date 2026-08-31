"""Inbound loop — write a volunteer's answer to a dispatched shift into CouchDB.

The public plane cannot reach CouchDB, so FastAPI records the answer in Mongo and this
loop applies it to the shelter's own ``shift_assignment`` document.

Unlike the application loop this does not create a document, it patches one that staff
also edit, so each pass re-reads the current revision rather than writing a document it
composed earlier. A conflict simply leaves the row unsynced for the next pass.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from tent_model.shift_response_buffer import ShiftResponseBuffer

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 3

#: What an answer sets the shift's own status to. Accepting puts the volunteer on
#: standby until they check in on the day; declining takes them off the roster, which
#: the projector then drops from the public schedule.
_STATUS_FOR = {"accepted": "standby", "declined": "cancelled"}


async def _apply_response(couch: CouchClient, response: ShiftResponseBuffer) -> bool:
    database = shelter_db_name(response.shelter_code)
    doc = await couch.get_doc(database, response.id)
    if doc is None:
        # Staff deleted the assignment between the offer and the answer. Nothing to
        # patch and nothing to retry — mark it done so the row stops being polled.
        logger.warning("Shift assignment %s is gone — dropping its response", response.id)
        response.synced_to_couch = True
        await response.save()
        return True

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    doc["dispatch_status"] = response.action
    doc["status"] = _STATUS_FOR.get(response.action, doc.get("status", "assigned"))
    doc["updated_at"] = now
    # The code is single use. Clearing it here is what stops a second answer even if a
    # manager reads the same code out again by mistake.
    doc["response_code"] = None
    doc["responded_at"] = response.responded_at.isoformat().replace("+00:00", "Z")

    try:
        result = await couch.put_doc(database, doc)
    except Exception:
        logger.exception("Failed to apply shift response %s", response.id)
        return False

    if not result.get("ok"):
        # Most likely a revision conflict with a staff edit — leave it for the next
        # pass, which re-reads the document.
        logger.warning("CouchDB did not accept shift response %s: %s", response.id, result)
        return False

    response.synced_to_couch = True
    await response.save()
    logger.info("Applied %s response for %s", response.action, response.id)
    return True


async def run_shift_response_inbound_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    while not stop_event.is_set():
        try:
            pending = await ShiftResponseBuffer.find(
                ShiftResponseBuffer.synced_to_couch == False  # noqa: E712
            ).to_list()
            for response in pending:
                if stop_event.is_set():
                    break
                await _apply_response(couch, response)
        except Exception:
            logger.exception("Inbound shift response poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
