"""Inbound loop — apply a volunteer's own profile edit to CouchDB.

The public plane cannot reach CouchDB, so FastAPI records the edit in Mongo and this
loop writes it onto the shelter's ``volunteer`` document, which stays the system of
record. Like the shift-response loop and unlike the application loop, this patches a
document staff also edit, so each pass re-reads the current revision rather than writing
one it composed earlier; a conflict simply leaves the row for the next pass.

Only the fields a volunteer owns are touched. ``identity_verified``, ``status``,
``volunteer_code`` and ``personnel_type`` are staff decisions and are never read off the
buffer — an edit cannot express a change to them even if the row were tampered with.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from tent_model.volunteer_profile_update_buffer import VolunteerProfileUpdateBuffer

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 3


async def _apply_update(
    couch: CouchClient, update: VolunteerProfileUpdateBuffer
) -> bool:
    """Patch every document this edit names. All-or-nothing per pass.

    One person can hold a ``volunteer`` document at several shelters, and the portal
    edits "their profile", not one shelter's copy — so a partial pass must not be marked
    done: the next pass re-reads and finishes the rest, and re-applying the same skills
    to a document that already has them is a no-op.
    """
    if not update.targets:
        # Nothing resolved when the edit was made — the volunteer has no profile the
        # public plane can see. Retrying cannot change that.
        logger.warning("Profile update %s names no documents — dropping it", update.id)
        update.synced_to_couch = True
        await update.save()
        return True

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    applied = 0
    for target in update.targets:
        database = shelter_db_name(target.shelter_code)
        doc = await couch.get_doc(database, target.volunteer_id)
        if doc is None:
            # Staff deleted the profile between the edit and this pass. Count it as
            # handled rather than blocking the rest of the targets forever.
            logger.warning("Volunteer %s is gone — skipping it", target.volunteer_id)
            applied += 1
            continue
        if doc.get("skills") == list(update.skills):
            applied += 1
            continue

        doc["skills"] = list(update.skills)
        doc["updated_at"] = now
        try:
            result = await couch.put_doc(database, doc)
        except Exception:
            logger.exception(
                "Failed to apply profile update %s to %s", update.id, doc["_id"]
            )
            continue
        if result.get("ok"):
            applied += 1
        else:
            # Most likely a revision conflict with a staff edit — the next pass re-reads.
            logger.warning(
                "CouchDB did not accept profile update %s: %s", update.id, result
            )

    if applied < len(update.targets):
        return False

    update.synced_to_couch = True
    await update.save()
    logger.info("Applied profile update %s to %d document(s)", update.id, applied)
    return True


async def run_volunteer_profile_inbound_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    while not stop_event.is_set():
        try:
            pending = await VolunteerProfileUpdateBuffer.find(
                VolunteerProfileUpdateBuffer.synced_to_couch == False  # noqa: E712
            ).to_list()
            for update in pending:
                if stop_event.is_set():
                    break
                await _apply_update(couch, update)
        except Exception:
            logger.exception("Inbound volunteer profile poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
