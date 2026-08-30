"""Flip reservations past their TTL to ``expired`` in CouchDB (T-21 DoD, FR-35).

Runs in the worker rather than as a public HTTP endpoint: expiring a reservation is an
unauthenticated-triggerable full scan of every shelter database, and the previous
``/api/v1/cron/expire-reservations`` route had no auth and nothing scheduling it, so the
TTL half of T-21 never actually ran.

Scope note — this flips the CouchDB donation doc only. Releasing the quota happens in
``retention.job.purge_expired_buffers``, where CR-047 places it, and now also in
``quota.settle`` as soon as the flip comes back round the change feed. Whichever lands
first wins and the other is a no-op: ``settle`` compares the buffer's own status before
releasing, and retention skips rows that are no longer ``declared``. Consolidating the
TTL release into this module would still need a scope amendment to CR-047 — see the
follow-up note in T-21.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from worker.couch.bootstrap import list_all_shelter_codes
from worker.couch.client import CouchClient
from worker.donation_status import DONATION_OUTSTANDING_STATUSES
from worker.masking import shelter_db_name

logger = logging.getLogger(__name__)

#: Only a reservation still awaiting drop-off expires. ``received`` consumed the target
#: for real; ``cancelled``/``expired`` are already released (schema.md §2.3 is
#: forward-only, so re-expiring is not even a legal transition).
#:
#: Every status still awaiting drop-off belongs here, not just ``declared``: CR-052 opens
#: public bookings at ``pending_review``, so pinning this to ``declared`` would leave
#: their TTL to lapse with the quota never handed back (CR-045).
EXPIRABLE_STATUSES = DONATION_OUTSTANDING_STATUSES


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def should_expire(status: Any, expires_at: Any, *, now: datetime) -> bool:
    """Pure predicate — is this donation a reservation whose TTL has passed?"""
    if status not in EXPIRABLE_STATUSES:
        return False
    if not isinstance(expires_at, str) or not expires_at:
        return False
    try:
        deadline = datetime.fromisoformat(expires_at)
    except ValueError:
        # Bad data must not stall the sweep for every other donation in the database.
        logger.warning("Unparseable expires_at %r — skipping", expires_at)
        return False
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=UTC)
    return deadline < now


async def expire_declared_donations(couch: CouchClient, *, now: datetime) -> int:
    """Sweep every shelter database and expire reservations past their TTL.

    Returns how many documents were flipped.
    """
    total = 0
    for code in await list_all_shelter_codes(couch):
        database = shelter_db_name(code)
        if not await couch.database_exists(database):
            continue

        # Collect before writing: iter_all_docs pages through _all_docs, and updating
        # documents mid-iteration would shift the pages under us.
        stale: list[dict[str, Any]] = [
            doc
            async for doc in couch.iter_all_docs(database)
            if doc.get("type") == "donation"
            and should_expire(doc.get("status"), doc.get("expires_at"), now=now)
        ]

        for doc in stale:
            try:
                await couch.put_doc(database, {**doc, "status": "expired", "updated_at": _iso(now)})
            except Exception:
                logger.exception("Failed to expire donation %s in %s", doc.get("_id"), database)
                continue
            total += 1

        if stale:
            logger.info("Expired %d reservation(s) in %s", len(stale), database)

    return total
