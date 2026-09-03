"""Recompute ``donation_need_counter.reserved_qty`` from the systems of record.

Backing the CR-047 §Migration & Maintenance tools (One-time Backfill Script +
Recalculation CLI). Lives in the worker because it is the only component holding both a
CouchDB client and Mongo access — FastAPI cannot read CouchDB at all (the gap CR-060
was raised for).

**Truth set — deliberately NOT ``DonationBuffer`` alone.** CR-047 §Migration says to
derive ``reserved_qty`` from ``DonationBuffer``, but that collection is transient: the
retention job deletes buffer rows once they are expired *and* synced to CouchDB
(``purge_expired_buffers``), including ``received`` ones whose quota stays consumed
forever. Summing only surviving buffers therefore *undercounts* every donation older
than its 72h TTL and would hand that quota back out — the exact overbooking CR-047
exists to prevent. So the truth set here is:

1. CouchDB ``donation:`` docs in ``shelter_<code>`` — authoritative for everything synced
   (and the only place staff walk-in donations exist at all)
2. Mongo ``DonationBuffer`` rows with ``synced_to_couch=False`` — created but not yet in
   CouchDB; counting them keeps the pre-inbound window from under-reserving

deduped by donation id, since (2) becomes (1) as soon as inbound catches up.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from tent_model import (
    DonationBuffer,
    DonationNeedCounter,
    set_qty_target,
    set_reserved_qty,
)

from worker.couch.client import CouchClient
from worker.donation_status import DONATION_OUTSTANDING_STATUSES
from worker.masking import shelter_db_name

logger = logging.getLogger(__name__)

# A donation holds quota until it is explicitly given back. "cancelled"/"expired"
# release via cancel()/purge_expired_buffers(); everything else still consumes.
#
# The pre-shelf half of this is every outstanding status, not just "declared": since
# CR-052 a public booking sits in "pending_review"/"verifying" while it waits, and
# leaving those out would make reconcile read their quota as unheld and zero out
# counters for reservations that are very much still live.
QUOTA_HOLDING_STATUSES = DONATION_OUTSTANDING_STATUSES | {"received"}

QuotaKey = tuple[str, str]  # (campaign_id, item_id)


@dataclass
class ShelterReconcileReport:
    shelter_code: str
    counters_seeded: int = 0
    counters_examined: int = 0
    counters_changed: int = 0
    counters_conflicted: int = 0
    donations_counted: int = 0
    # Items that hold real goods but cannot be attributed to a counter. Reported, never
    # guessed at: the frontend has a free-text→item_id heuristic, but applying it here
    # could inflate reserved_qty against the wrong item and wrongly close a need.
    unattributed_items: list[str] = field(default_factory=list)
    computed: dict[QuotaKey, Decimal] = field(default_factory=dict)
    changes: list[tuple[QuotaKey, Decimal, Decimal]] = field(default_factory=list)
    conflicts: list[QuotaKey] = field(default_factory=list)
    # Ceilings that drifted from their campaign (CR-060 FR-2 consequence), and the ones
    # refused because lowering them would strand quota donors already hold.
    targets_changed: int = 0
    target_changes: list[tuple[QuotaKey, Decimal, Decimal]] = field(
        default_factory=list
    )
    target_conflicts: list[QuotaKey] = field(default_factory=list)
    target_refused: list[tuple[QuotaKey, Decimal, Decimal]] = field(
        default_factory=list
    )
    # Outstanding qty whose counter does not exist yet. On a first backfill dry run this
    # is where the whole picture lives — without it the operator sees "0 to change" and
    # cannot tell what the run will actually establish.
    missing_counters: list[tuple[QuotaKey, Decimal]] = field(default_factory=list)


def _to_decimal(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None


def _normalize_donation_id(raw: str) -> str:
    return raw if raw.startswith("donation:") else f"donation:{raw}"


def sum_reserved_by_key(
    donations: list[dict[str, Any]],
    *,
    report: ShelterReconcileReport | None = None,
) -> dict[QuotaKey, Decimal]:
    """Total outstanding qty per ``(campaign_id, item_id)``.

    Each donation is ``{"_id", "campaign_id", "status", "items": [{"item_id", "qty"}]}``.

    Uses ``items[].qty`` rather than the ``reserved_qty`` stamped at booking time on
    purpose: a donation that slipped through FastAPI's ``NOT_SEEDED`` fail-open path
    carries no ``reserved_qty`` but still consumes real goods, and recalculation is
    supposed to reflect reality rather than replay what the counter happened to record.
    """
    totals: dict[QuotaKey, Decimal] = {}
    for donation in donations:
        if donation.get("status") not in QUOTA_HOLDING_STATUSES:
            continue
        campaign_id = donation.get("campaign_id")
        donation_id = str(donation.get("_id", "?"))
        for item in donation.get("items") or []:
            qty = _to_decimal(item.get("qty"))
            item_id = item.get("item_id")
            if qty is None or qty <= 0:
                continue
            if not campaign_id or not item_id:
                if report is not None:
                    report.unattributed_items.append(
                        f"{donation_id} qty={qty} "
                        f"item_id={item_id or '-'} campaign_id={campaign_id or '-'}"
                    )
                continue
            key = (str(campaign_id), str(item_id))
            totals[key] = totals.get(key, Decimal(0)) + qty
        if report is not None:
            report.donations_counted += 1
    return totals


async def _collect_truth_set(
    couch: CouchClient, shelter_code: str
) -> list[dict[str, Any]]:
    donations: dict[str, dict[str, Any]] = {}

    database = shelter_db_name(shelter_code)
    if await couch.database_exists(database):
        async for doc in couch.iter_all_docs(database):
            if doc.get("type") != "donation":
                continue
            doc_id = doc.get("_id")
            if not doc_id:
                continue
            donations[_normalize_donation_id(str(doc_id))] = doc
    else:
        logger.warning("CouchDB database %s missing — counting buffers only", database)

    unsynced = await DonationBuffer.find(
        DonationBuffer.shelter_code == shelter_code,
        DonationBuffer.synced_to_couch == False,
    ).to_list()
    for buffer in unsynced:
        key = _normalize_donation_id(buffer.id)
        # A CouchDB doc always wins — inbound has already persisted this one and the
        # buffer's synced flag is merely stale.
        donations.setdefault(
            key,
            {
                "_id": key,
                "campaign_id": buffer.campaign_id,
                "status": buffer.status,
                "items": buffer.items_declared,
            },
        )

    return list(donations.values())


async def _campaign_targets(
    couch: CouchClient, shelter_code: str
) -> dict[QuotaKey, Decimal]:
    """``qty_target`` of every need on every OPEN campaign, straight from CouchDB.

    Closed campaigns are skipped on purpose: their counters keep whatever ceiling they
    were seeded with so outstanding reservations stay attributable (CR-060 FR-4 —
    nothing deletes or rewrites a closed campaign's counter).
    """
    targets: dict[QuotaKey, Decimal] = {}
    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        return targets

    async for doc in couch.iter_all_docs(database):
        if doc.get("type") != "donation_campaign" or doc.get("status") != "open":
            continue
        campaign_id = doc.get("_id")
        if not campaign_id:
            continue
        for need in doc.get("needs") or []:
            item_id = need.get("item_id")
            if not item_id:
                continue
            try:
                qty_target = Decimal(str(need.get("qty_target")))
            except (InvalidOperation, TypeError):
                continue
            if qty_target < 0:
                continue
            targets.setdefault((str(campaign_id), str(item_id)), qty_target)
    return targets


async def _realign_target(
    counter: dict[str, Any],
    key: QuotaKey,
    campaign_targets: dict[QuotaKey, Decimal],
    *,
    shelter_code: str,
    report: ShelterReconcileReport,
    now: datetime,
    apply: bool,
) -> None:
    """Move one counter's ceiling onto its campaign's current ``qty_target``.

    Refuses to lower a ceiling below the quota donors already hold: those bookings were
    accepted under the old ceiling and are still owed, so a lower ``qty_target`` would
    make ``reserved_qty + qty <= qty_target`` false for reservations that already exist
    — the need would read as over-full and could never be released cleanly. Reported for
    the operator to settle (close the need, or cancel bookings first), never applied.

    The guard reads the LARGER of the stored and the freshly recomputed reserve. Target
    realignment runs before ``reserved_qty`` is written, so the stored figure alone can
    be stale — trusting it would lower a ceiling under quota this very run is about to
    record as held.
    """
    campaign_id, item_id = key
    wanted = campaign_targets.get(key)
    if wanted is None:
        return

    stored_raw = counter["qty_target"]
    stored = stored_raw.to_decimal()
    if stored == wanted:
        return

    reserved = max(
        counter["reserved_qty"].to_decimal(), report.computed.get(key, Decimal(0))
    )
    if wanted < reserved:
        report.target_refused.append((key, stored, wanted))
        logger.error(
            "refusing to lower qty_target for %s/%s/%s to %s — %s already reserved",
            shelter_code,
            campaign_id,
            item_id,
            wanted,
            reserved,
        )
        return

    report.target_changes.append((key, stored, wanted))
    if not apply:
        return

    ok = await set_qty_target(
        shelter_code=shelter_code,
        campaign_id=campaign_id,
        item_id=item_id,
        expected=stored_raw,
        new_value=wanted,
        now=now,
    )
    if ok:
        report.targets_changed += 1
    else:
        report.target_conflicts.append(key)
        logger.error(
            "qty_target for %s/%s/%s changed mid-run — re-run inside a maintenance "
            "window (CR-047 Cutover Lock)",
            shelter_code,
            campaign_id,
            item_id,
        )


async def reconcile_shelter(
    couch: CouchClient,
    shelter_code: str,
    *,
    now: datetime,
    apply: bool,
    targets: bool = False,
) -> ShelterReconcileReport:
    """Recompute every counter of one shelter. ``apply=False`` writes nothing.

    ``targets=True`` additionally realigns ``qty_target`` with the open campaign it came
    from — the gap CR-060 FR-2 leaves open by design and names this tool to close.
    """
    report = ShelterReconcileReport(shelter_code=shelter_code)

    truth = await _collect_truth_set(couch, shelter_code)
    report.computed = sum_reserved_by_key(truth, report=report)
    campaign_targets = await _campaign_targets(couch, shelter_code) if targets else {}

    # Read raw so the exact Decimal128 can be handed back as the optimistic filter.
    collection = DonationNeedCounter.get_motor_collection()
    counters = await collection.find({"shelter_code": shelter_code}).to_list(
        length=None
    )

    seen_keys: set[QuotaKey] = set()
    for counter in counters:
        report.counters_examined += 1
        campaign_id = str(counter.get("campaign_id", ""))
        item_id = str(counter.get("item_id", ""))
        seen_keys.add((campaign_id, item_id))
        key = (campaign_id, item_id)
        if targets:
            await _realign_target(
                counter,
                key,
                campaign_targets,
                shelter_code=shelter_code,
                report=report,
                now=now,
                apply=apply,
            )

        stored_raw = counter["reserved_qty"]
        stored = stored_raw.to_decimal()
        expected = report.computed.get((campaign_id, item_id), Decimal(0))

        if stored == expected:
            continue

        report.changes.append((key, stored, expected))
        if not apply:
            continue

        ok = await set_reserved_qty(
            shelter_code=shelter_code,
            campaign_id=campaign_id,
            item_id=item_id,
            expected=stored_raw,
            new_value=expected,
            now=now,
        )
        if ok:
            report.counters_changed += 1
        else:
            report.counters_conflicted += 1
            report.conflicts.append(key)
            logger.error(
                "reserved_qty for %s/%s/%s changed mid-run — a booking raced the "
                "recalculation; re-run inside a maintenance window (CR-047 Cutover Lock)",
                shelter_code,
                campaign_id,
                item_id,
            )

    report.missing_counters = sorted(
        (key, qty) for key, qty in report.computed.items() if key not in seen_keys
    )
    return report
