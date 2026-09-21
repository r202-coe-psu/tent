"""Write donation_need_counter seeds to MongoDB (CR-060)."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, datetime

from tent_model import DonationNeedCounter, counter_id, seed_counter, set_qty_target

from worker.projectors.donation_need_counter import NeedCounterSeed
from worker.quota_target_rules import TargetDecision, decide_target_change

logger = logging.getLogger(__name__)


async def _realign_existing(seed: NeedCounterSeed, *, now: datetime) -> bool:
    """Move an existing counter's ceiling onto the campaign's current target.

    Returns ``True`` when the ceiling actually moved.

    The optimistic filter inside ``set_qty_target`` carries the ``qty_target`` read a
    moment ago, so a concurrent move loses rather than overwrites; the next campaign
    edit — or the recalculation CLI — settles it. A miss is logged, not retried here:
    retrying inside a CDC handler would block the change feed on a contended counter.
    """
    doc = await DonationNeedCounter.get_pymongo_collection().find_one(
        {"_id": counter_id(seed.shelter_code, seed.campaign_id, seed.item_id)}
    )
    if doc is None:
        # Deleted between the seed attempt and this read. Nothing to realign; the next
        # campaign edit re-seeds it.
        return False

    stored_raw = doc["qty_target"]
    decision = decide_target_change(
        stored=stored_raw.to_decimal(),
        wanted=seed.qty_target,
        # Only the stored figure is available here. Unlike the CLI this path cannot
        # recompute from `DonationBuffer` — a full donation scan per campaign edit would
        # put the change feed behind the shelter's write rate. Staleness is one-sided
        # and safe: `reserved_qty` is `$inc`-ed by FastAPI the instant a booking is
        # accepted, so a value read here can only be BEHIND, never ahead, and a refusal
        # computed from it is conservative.
        reserved=doc["reserved_qty"].to_decimal(),
    )

    if decision is TargetDecision.UNCHANGED:
        return False

    if decision is TargetDecision.REFUSED_BELOW_RESERVED:
        # Staff lowered the campaign target under quota donors already hold. The board
        # and `public_needs` show the new figure; the ceiling stays where the bookings
        # were made. The edit form blocks this, so reaching here means the target moved
        # by some other path (seed, CLI, direct CouchDB write).
        logger.error(
            "refusing to lower qty_target for %s/%s/%s to %s — %s already reserved",
            seed.shelter_code,
            seed.campaign_id,
            seed.item_id,
            seed.qty_target,
            doc["reserved_qty"].to_decimal(),
        )
        return False

    moved = await set_qty_target(
        shelter_code=seed.shelter_code,
        campaign_id=seed.campaign_id,
        item_id=seed.item_id,
        expected=stored_raw,
        new_value=seed.qty_target,
        now=now,
    )
    if not moved:
        logger.warning(
            "qty_target for %s/%s/%s moved concurrently — left at its current value",
            seed.shelter_code,
            seed.campaign_id,
            seed.item_id,
        )
    return moved


async def apply_need_counters(seeds: Iterable[NeedCounterSeed]) -> tuple[int, int]:
    """Seed each planned counter, then move the ceiling of any that already existed.

    Returns ``(created, realigned)``.

    Not routed through ``worker.mongo.upsert.apply_document`` on purpose — that helper
    rewrites the whole document and would clobber ``reserved_qty``, which FastAPI owns
    (CR-060 FR-3). ``seed_counter`` and ``set_qty_target`` touch only the worker's own
    fields.

    **Realignment supersedes CR-060 FR-2** (`$setOnInsert` only, ceiling frozen at
    creation). FR-2 left "แก้เป้าหมาย" not working: the board and `public_needs`
    recompute to the new target while donors keep hitting `NEED_FULL` at the old one —
    CR-060 §Decision log calls that a Known consequence, and only an operator running
    `donation-quota recalculate --targets` could close it. The two reasons FR-2 gave do
    not hold: the reserve and this write are both single-document atomic ops that Mongo
    serialises, and CDC replay is safe because `_changes` is read with `include_docs`
    and hands back the CURRENT revision, not the one at that sequence. What does need
    guarding — lowering a ceiling under quota already held — is guarded explicitly, by
    the same rule the CLI uses (`worker.quota_target_rules`).
    """
    now = datetime.now(UTC)
    created = 0
    realigned = 0
    for seed in seeds:
        if await seed_counter(
            shelter_code=seed.shelter_code,
            campaign_id=seed.campaign_id,
            item_id=seed.item_id,
            qty_target=seed.qty_target,
            now=now,
        ):
            created += 1
            continue
        # Already existed, so `$setOnInsert` ignored this target — decide separately.
        if await _realign_existing(seed, now=now):
            realigned += 1
    if created:
        logger.info("seeded %d donation_need_counter doc(s)", created)
    if realigned:
        logger.info(
            "realigned qty_target on %d donation_need_counter doc(s)", realigned
        )
    return created, realigned
