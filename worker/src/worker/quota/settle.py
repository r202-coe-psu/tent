"""Keep the intake buffer in step with CouchDB and release quota when it stops holding.

Every quota-release guard in the system reads ``DonationBuffer.status``:
``retention.purge_expired_buffers`` releases only for ``declared`` rows, and FastAPI's
``DonationsUseCase.cancel`` sets ``cancelled`` precisely so that retention pass skips a
reservation it already gave back. But that ``cancel()`` was the *only* writer of the
field, and it refuses to run once ``synced_to_couch`` is true — so the moment inbound
persisted a donation the buffer's status froze at ``declared`` while the system of
record moved on without it.

Two leaks followed, both silent:

* A donor cancelling *after* inbound sync goes through the SvelteKit BFF, which writes
  ``cancelled`` straight to CouchDB and never reaches FastAPI. Nothing released the
  counter, so the item stayed full until the 72h TTL purge — a cancelled reservation
  blocking donors who could have taken its place for three days.
* A ``received`` donation still had a ``declared`` buffer, so at TTL the retention pass
  released quota for goods physically sitting in the shelter, handing the same target
  out a second time. That is the overbooking CR-047 exists to prevent, arriving through
  the back door.

Settling here, off the change feed, fixes both without moving where releases live:
the buffer follows CouchDB, and the guards downstream start meaning what they say.
``QUOTA_HOLDING_STATUSES`` is the same set the recalculation CLI reconciles against
(CR-061), so the live path and the repair path can no longer disagree.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from tent_model import DonationBuffer, release_quota

from worker.quota.reconcile import QUOTA_HOLDING_STATUSES, reconcile_shelter

logger = logging.getLogger(__name__)


async def _release_reservation(buffer: DonationBuffer, *, now: datetime) -> Decimal:
    """Give back every quantity this donation reserved. Returns the total released."""
    if not buffer.campaign_id:
        return Decimal("0")

    total = Decimal("0")
    for item in buffer.items_declared:
        item_id = item.get("item_id")
        raw = item.get("reserved_qty")
        # No "reserved_qty" means the item bypassed the counter (free-text, or booked
        # before CR-047) — there is nothing to hand back.
        if not item_id or raw is None:
            continue
        try:
            qty = Decimal(str(raw))
        except InvalidOperation:
            logger.warning(
                "Unparseable reserved_qty %r on donation %s — skipping release", raw, buffer.id
            )
            continue
        await release_quota(
            shelter_code=buffer.shelter_code,
            campaign_id=buffer.campaign_id,
            item_id=item_id,
            qty=qty,
            now=now,
        )
        total += qty
    return total


async def settle_donation_quota(doc: dict[str, Any], *, now: datetime) -> Decimal:
    """Sync the buffer to ``doc``'s status, releasing quota if it stopped holding it.

    Returns the total quantity released — zero when nothing changed hands.

    Idempotent: the transition is decided by comparing the buffer's *own* status against
    the document's, so replaying the same change row a second time finds them equal and
    does nothing. That matters because the counter is an unconditional ``$inc`` — a
    double release would silently reopen a need that is genuinely full.
    """
    token_hash = doc.get("tracking_token_hash")
    if not token_hash:
        # Staff walk-in: never went through the public reserve path, holds no counter.
        return Decimal("0")

    new_status = doc.get("status")
    if not isinstance(new_status, str) or not new_status:
        return Decimal("0")

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
    if buffer is None:
        # Retention already purged the row — and released the quota on its way out.
        return Decimal("0")
    if buffer.status == new_status:
        # Nothing moved — skip the write. Not load-bearing for correctness (the
        # transition check below already makes a replay a no-op), just a guard against
        # a pointless Mongo write on every donation change row.
        return Decimal("0")

    released = Decimal("0")
    if buffer.status in QUOTA_HOLDING_STATUSES and new_status not in QUOTA_HOLDING_STATUSES:
        released = await _release_reservation(buffer, now=now)
        if released:
            logger.info(
                "Released %s reserved qty for donation %s (%s → %s)",
                released,
                buffer.id,
                buffer.status,
                new_status,
            )

    buffer.status = new_status
    await buffer.save()
    return released


async def reserve_walk_in_quota(
    couch: Any,
    doc: dict[str, Any],
    *,
    shelter_code: str,
    now: datetime,
) -> bool:
    """Count a donation that reached CouchDB without ever reserving quota.

    Only public bookings go through ``reserve_quota``: they are created by FastAPI,
    which increments the counter as it accepts them. A donation staff key in at the
    shelter is written straight to CouchDB, so the counter never hears about it — it
    reported 360 while the shelter had 410 owed against a 500 target, and handed the
    difference back out to donors.

    CR-061 already settled that these count: ``sum_reserved_by_key`` treats every
    CouchDB donation in a quota-holding status as reserved, walk-ins included, so
    ``donation-quota recalculate`` would correct the counter to exactly this figure.
    The live path simply disagreed with the tool meant to repair it.

    Rather than add a second way to move ``reserved_qty``, this reuses that same
    reconciliation, which makes it idempotent for free: it *sets* the counter to the
    recomputed truth instead of incrementing, so replaying a change row cannot
    double-count, and a booking landing mid-run is reported as a conflict and left
    alone (CR-047 Cutover Lock) rather than stomped.

    Returns whether a reconciliation ran.
    """
    # `channel` is the only honest signal here. Every donation carries a
    # `tracking_token_hash` — staff walk-ins included, so donors can be given a ticket —
    # and schema.md §2.3 defines `channel: public` as "came from /public/v1", which is
    # exactly the path that already called reserve_quota. Re-counting one of those would
    # be the double-count this function exists to avoid.
    if doc.get("channel") == "public":
        return False
    # No campaign means no counter to hold — free-text and out-of-campaign walk-ins
    # bypass the quota mechanism entirely, as they always have.
    if not doc.get("campaign_id"):
        return False
    if doc.get("status") not in QUOTA_HOLDING_STATUSES:
        return False
    if not any(item.get("item_id") for item in doc.get("items") or []):
        return False

    report = await reconcile_shelter(couch, shelter_code, now=now, apply=True)
    if report.counters_changed:
        logger.info(
            "Walk-in donation %s brought %d counter(s) in line for %s",
            doc.get("_id"),
            report.counters_changed,
            shelter_code,
        )
    if report.counters_conflicted:
        # A booking landed mid-run. The counter keeps the live value; the next donation
        # change, or the scheduled recalculation, settles it.
        logger.warning(
            "Reconcile for %s hit %d conflict(s) after walk-in %s",
            shelter_code,
            report.counters_conflicted,
            doc.get("_id"),
        )
    return True
