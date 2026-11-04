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

from tent_model import DonationBuffer, release_quota, release_slot

from worker.quota.reconcile import QUOTA_HOLDING_STATUSES, reconcile_shelter

logger = logging.getLogger(__name__)


async def _release_reservation(buffer: DonationBuffer, *, now: datetime) -> Decimal:
    """Give back every quantity this donation reserved. Returns the total released."""
    if not buffer.campaign_id:
        return Decimal(0)

    total = Decimal(0)
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
                "Unparseable reserved_qty %r on donation %s — skipping release",
                raw,
                buffer.id,
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
        return Decimal(0)

    new_status = doc.get("status")
    if not isinstance(new_status, str) or not new_status:
        return Decimal(0)

    # The donor edits this row while settle runs. Write only the status, and only over
    # the status read; the pre-image is what the booking held as it stopped holding.
    # A whole-row save put the read items back over a donor's edit and released them.
    for _ in range(3):
        buffer = await DonationBuffer.find_one(
            {"tracking_token_hash": token_hash, "synced_to_couch": True}
        )
        if buffer is None:
            # Retention already purged the row — and released the quota on its way out —
            # or inbound has not synced it yet. Until it has, Mongo owns the row's status
            # (a donor cancel there already released the quota); inbound catches up on
            # the CouchDB doc right after it flips the flag.
            return Decimal(0)
        if buffer.status == new_status:
            # Nothing moved: a replay of a change already settled.
            return Decimal(0)
        before = await DonationBuffer.get_pymongo_collection().find_one_and_update(
            {"_id": buffer.id, "synced_to_couch": True, "status": buffer.status},
            {"$set": {"status": new_status}},
        )
        if before is not None:
            break
    else:
        logger.warning(
            "Status of donation buffer %s kept moving — leaving it to the next change",
            buffer.id,
        )
        return Decimal(0)
    buffer.items_declared = before.get("items_declared") or []

    released = Decimal(0)
    if (
        buffer.status in QUOTA_HOLDING_STATUSES
        and new_status not in QUOTA_HOLDING_STATUSES
    ):
        released = await _release_reservation(buffer, now=now)
        # The queue place is held by the same statuses as the quota (frontend
        # `countSlotBookings`), so it goes back on the same transition.
        if buffer.slot_counter_id:
            await release_slot(counter_id=buffer.slot_counter_id, now=now)
        if released:
            logger.info(
                "Released %s reserved qty for donation %s (%s → %s)",
                released,
                buffer.id,
                buffer.status,
                new_status,
            )
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


async def settle_shelved_quota(couch: Any, shelter_code: str, *, now: datetime) -> None:
    """Hand back the reservation of goods that just reached the stock ledger.

    A ``received`` donation keeps holding quota (``QUOTA_HOLDING_STATUSES``), but once
    its rows land in the ledger ``refresh_on_hand`` raises ``on_hand_qty`` by the same
    goods — and ``reserve_quota`` caps at ``qty_target − on_hand_qty − reserved_qty``.
    Left alone, the goods came off the ceiling twice: the board showed 89 open, and a
    donor booking all 89 was told the need was full.

    Same reconciliation as :func:`reserve_walk_in_quota` — it *sets* ``reserved_qty`` to
    the recomputed truth, which already leaves recorded goods out, so replaying a ledger
    change row is a no-op and a booking racing it is reported, not stomped.

    A conflicted counter keeps its doubled-up value, which only ever errs strict —
    but it would hold until the shelter's next donation or ledger change, refusing
    donors in the meantime. So a conflict gets one more pass. The booking behind it
    reserved before the failed write; its buffer insert follows within milliseconds,
    well before the re-run's full shelter scan reaches the buffers, so the re-read
    counts it. A second conflict is left for the next change, as before.
    """
    report = await reconcile_shelter(couch, shelter_code, now=now, apply=True)
    changed = report.counters_changed
    if report.counters_conflicted:
        report = await reconcile_shelter(couch, shelter_code, now=now, apply=True)
        changed += report.counters_changed
    if changed:
        logger.info(
            "Settled shelved goods: %d counter(s) brought in line for %s",
            changed,
            shelter_code,
        )
    if report.counters_conflicted:
        logger.warning(
            "Reconcile for %s hit %d conflict(s) settling shelved goods",
            shelter_code,
            report.counters_conflicted,
        )
