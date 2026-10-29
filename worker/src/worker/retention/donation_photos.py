"""Sweep donor photos no booking ever bound (CR-175 donor photos FR-16, FR-16a).

A donor uploads each photo as soon as they pick it; the booking that names it may never
come. Such a photo has ``purpose: 'donation'`` and no ``donation_id``. After 24 hours it
goes. A photo with a ``donation_id`` is never touched, whatever became of its booking.

The delete carries the ``_rev`` the query returned, so a photo the inbound worker binds
between the read and the delete makes the delete conflict and survives.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from worker.couch.bootstrap import list_all_shelter_codes
from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.timeutil import iso_utc

logger = logging.getLogger(__name__)

ORPHAN_AFTER = timedelta(hours=24)
BATCH_SIZE = 200

#: ``[ddoc, name]`` of ``DONATION_PHOTO_ORPHAN_MANGO_INDEX`` in
#: ``frontend/src/lib/server/shelter-access-design.ts``, which deploys it.
ORPHAN_PHOTO_INDEX = ["donation-photo-orphans", "image-donation-unbound-created-idx"]


def orphan_photo_selector(now: datetime) -> dict:
    """The index's partial filter plus the age cut-off — CouchDB needs both to use it."""
    return {
        "type": "image",
        "purpose": "donation",
        "donation_id": {"$exists": False},
        "created_at": {"$lt": iso_utc(now - ORPHAN_AFTER)},
    }


async def sweep_shelter_orphan_photos(
    couch: CouchClient, database: str, *, now: datetime
) -> int:
    """Delete this shelter's unbound donor photos older than 24 h. Returns how many."""
    deleted = 0
    while True:
        rows = await couch.find(
            database,
            orphan_photo_selector(now),
            fields=["_id", "_rev"],
            limit=BATCH_SIZE,
            use_index=ORPHAN_PHOTO_INDEX,
        )
        if not rows:
            return deleted
        results = await couch.bulk_docs(
            database,
            [{"_id": r["_id"], "_rev": r["_rev"], "_deleted": True} for r in rows],
        )
        removed = sum(1 for r in results if not r.get("error"))
        deleted += removed
        # A full batch that removed nothing would read the same rows forever.
        if len(rows) < BATCH_SIZE or removed == 0:
            return deleted


async def sweep_orphan_donation_photos(couch: CouchClient, *, now: datetime) -> int:
    total = 0
    for code in await list_all_shelter_codes(couch):
        database = shelter_db_name(code)
        if not await couch.database_exists(database):
            continue
        try:
            removed = await sweep_shelter_orphan_photos(couch, database, now=now)
        except Exception:
            logger.exception("Donor photo sweep failed in %s", database)
            continue
        if removed:
            logger.info("Removed %d unbound donor photo(s) from %s", removed, database)
        total += removed
    return total
