"""Plan donation_need_counter seeds from a donation_campaign doc (CR-060).

Pure — no I/O, no Mongo. The write side lives in
``worker.mongo.donation_need_counter``; the atomic op itself is
``tent_model.donation_need_counter_ops.seed_counter`` (shared with FastAPI per
CR-047 §Shared Domain Helper).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, NamedTuple


class NeedCounterSeed(NamedTuple):
    shelter_code: str
    campaign_id: str
    item_id: str
    qty_target: Decimal


def plan_need_counters(campaign: dict[str, Any], *, shelter_code: str) -> list[NeedCounterSeed]:
    """One seed per entry in ``needs[]`` of an **open** campaign (CR-060 FR-1).

    Returns ``[]`` for anything else — a campaign that flips to ``closed`` yields no
    plan, which is how FR-4 ("ห้ามลบ counter ที่มีอยู่") is satisfied: there is simply
    no delete path.
    """
    if campaign.get("type") != "donation_campaign" or campaign.get("status") != "open":
        return []

    campaign_id = campaign.get("_id")
    if not campaign_id:
        return []

    seeds: list[NeedCounterSeed] = []
    seen: set[str] = set()
    for need in campaign.get("needs") or []:
        item_id = need.get("item_id")
        if not item_id or item_id in seen:
            # Same item twice in needs[] — keep the first so the plan is deterministic
            # (`$setOnInsert` would ignore the second anyway).
            continue
        try:
            qty_target = Decimal(str(need.get("qty_target")))
        except (InvalidOperation, TypeError):
            continue
        # A target of 0 is seeded on purpose: "ไม่ต้องการของชิ้นนี้" must reject
        # reservations, and skipping it would instead leave FastAPI's NOT_SEEDED
        # fail-open path accepting unlimited qty. Negative targets are bad data.
        if qty_target < 0:
            continue
        seen.add(str(item_id))
        seeds.append(
            NeedCounterSeed(
                shelter_code=shelter_code,
                campaign_id=str(campaign_id),
                item_id=str(item_id),
                qty_target=qty_target,
            )
        )
    return seeds
