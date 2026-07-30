"""Mongo-backed tests for the donation_need_counter seed path (CR-060 §Acceptance)."""

from datetime import UTC, datetime
from decimal import Decimal

import bson
from tent_model import DonationNeedCounter, counter_id, reserve_quota, seed_counter

from worker.mongo import apply_need_counters
from worker.projectors.donation_need_counter import plan_need_counters

SHELTER = "SH001"
CAMPAIGN = "donation_campaign:01"


def _campaign(needs, status="open"):
    return {
        "_id": CAMPAIGN,
        "type": "donation_campaign",
        "status": status,
        "needs": needs,
    }


async def _seed(campaign) -> int:
    return await apply_need_counters(plan_need_counters(campaign, shelter_code=SHELTER))


async def _get(item_id: str) -> DonationNeedCounter | None:
    return await DonationNeedCounter.get(counter_id(SHELTER, CAMPAIGN, item_id))


async def test_seeds_one_counter_per_need(db: None) -> None:
    created = await _seed(
        _campaign(
            [
                {"item_id": "item:rice", "qty_target": "10"},
                {"item_id": "item:water", "qty_target": "25"},
            ]
        )
    )
    assert created == 2

    rice = await _get("item:rice")
    water = await _get("item:water")
    assert rice is not None and water is not None
    assert rice.qty_target == Decimal("10")
    assert rice.reserved_qty == Decimal("0")
    assert rice.shelter_code == SHELTER
    assert rice.campaign_id == CAMPAIGN
    assert rice.item_id == "item:rice"
    assert water.qty_target == Decimal("25")


async def test_replaying_campaign_does_not_move_qty_target(db: None) -> None:
    """FR-2 — a later CDC event with an edited qty_target must not change the ceiling."""
    await _seed(_campaign([{"item_id": "item:rice", "qty_target": "10"}]))

    created = await _seed(_campaign([{"item_id": "item:rice", "qty_target": "999"}]))
    assert created == 0

    rice = await _get("item:rice")
    assert rice is not None
    assert rice.qty_target == Decimal("10")


async def test_replay_does_not_reset_reserved_qty(db: None) -> None:
    """FR-3 — worker must never touch reserved_qty, which FastAPI owns."""
    await _seed(_campaign([{"item_id": "item:rice", "qty_target": "10"}]))
    await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("4"),
        now=datetime.now(UTC),
    )

    await _seed(_campaign([{"item_id": "item:rice", "qty_target": "10"}]))

    rice = await _get("item:rice")
    assert rice is not None
    assert rice.reserved_qty == Decimal("4")
    assert rice.qty_target == Decimal("10")


async def test_closing_campaign_keeps_existing_counters(db: None) -> None:
    """FR-4 — counters survive campaign close and items dropping out of needs[]."""
    await _seed(_campaign([{"item_id": "item:rice", "qty_target": "10"}]))

    await _seed(_campaign([{"item_id": "item:rice", "qty_target": "10"}], status="closed"))
    await _seed(_campaign([{"item_id": "item:water", "qty_target": "5"}]))

    assert await _get("item:rice") is not None


async def test_seed_and_concurrent_inc_do_not_clobber_each_other(db: None) -> None:
    """Interleaved worker seed ($setOnInsert) and FastAPI reserve ($inc) — both survive."""
    now = datetime.now(UTC)
    await seed_counter(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty_target=Decimal("10"),
        now=now,
    )

    collection = DonationNeedCounter.get_motor_collection()
    cid = counter_id(SHELTER, CAMPAIGN, "item:rice")
    # FastAPI's $inc lands between two worker seeds of the same campaign.
    await collection.update_one({"_id": cid}, {"$inc": {"reserved_qty": bson.Decimal128("3")}})
    await seed_counter(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty_target=Decimal("10"),
        now=now,
    )
    await collection.update_one({"_id": cid}, {"$inc": {"reserved_qty": bson.Decimal128("2")}})

    rice = await _get("item:rice")
    assert rice is not None
    assert rice.qty_target == Decimal("10")
    assert rice.reserved_qty == Decimal("5")


async def test_reserve_quota_enforces_seeded_ceiling(db: None) -> None:
    """End-to-end: once seeded, FastAPI actually rejects at the campaign's target."""
    from tent_model import ReserveResult

    await _seed(_campaign([{"item_id": "item:rice", "qty_target": "10"}]))
    now = datetime.now(UTC)

    first = await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("10"),
        now=now,
    )
    second = await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("1"),
        now=now,
    )

    assert first is ReserveResult.RESERVED
    assert second is ReserveResult.NEED_FULL
