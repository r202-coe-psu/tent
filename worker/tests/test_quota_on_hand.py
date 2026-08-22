"""The reservation ceiling is qty_target − on_hand_qty, not qty_target.

Two donors booked 180 kg each against a 500 kg rice target the shelter already held
270 kg of, and the atomic counter waved both through: 360 ≤ 500. Every other place
that decides whether a need is still open — the public board, the back-office board,
the worker projector — has subtracted the warehouse since T-22. The counter was the
last one measuring against the bare target, and it is the only one that is binding.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock

from tent_model import (
    DonationNeedCounter,
    ReserveResult,
    counter_id,
    reserve_quota,
    seed_counter,
    set_on_hand_qty,
)

from worker.mongo.on_hand import on_hand_decimals, refresh_on_hand

SHELTER = "SH001"
CAMPAIGN = "donation_campaign:01"
ITEM = "item:rice"
NOW = datetime.now(UTC)


async def _seed(qty_target: str = "500") -> None:
    await seed_counter(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id=ITEM,
        qty_target=Decimal(qty_target),
        now=NOW,
    )


def _reserve(qty: str, campaign: str = CAMPAIGN):
    return reserve_quota(
        shelter_code=SHELTER, campaign_id=campaign, item_id=ITEM, qty=Decimal(qty), now=NOW
    )


async def test_a_seeded_counter_starts_with_an_empty_warehouse(db: None) -> None:
    await _seed()
    counter = await DonationNeedCounter.get(counter_id(SHELTER, CAMPAIGN, ITEM))
    assert counter is not None
    assert counter.on_hand_qty == Decimal("0")


async def test_the_warehouse_lowers_the_ceiling(db: None) -> None:
    """The exact case from the two-tab test: 500 target, 270 on hand, 180 + 180."""
    await _seed()
    await set_on_hand_qty(shelter_code=SHELTER, item_id=ITEM, qty=Decimal("270"), now=NOW)

    assert await _reserve("180") is ReserveResult.RESERVED
    assert await _reserve("180") is ReserveResult.NEED_FULL

    counter = await DonationNeedCounter.get(counter_id(SHELTER, CAMPAIGN, ITEM))
    assert counter is not None
    assert counter.reserved_qty == Decimal("180")


async def test_the_ceiling_is_exactly_target_minus_on_hand(db: None) -> None:
    await _seed()
    await set_on_hand_qty(shelter_code=SHELTER, item_id=ITEM, qty=Decimal("270"), now=NOW)

    assert await _reserve("231") is ReserveResult.NEED_FULL
    assert await _reserve("230") is ReserveResult.RESERVED


async def test_a_full_warehouse_takes_no_bookings_at_all(db: None) -> None:
    await _seed()
    await set_on_hand_qty(shelter_code=SHELTER, item_id=ITEM, qty=Decimal("500"), now=NOW)

    assert await _reserve("1") is ReserveResult.NEED_FULL


async def test_a_counter_predating_the_field_keeps_the_old_ceiling(db: None) -> None:
    """$ifNull: an unmigrated counter has no on_hand_qty and must not stop reserving."""
    await _seed()
    await DonationNeedCounter.get_motor_collection().update_one(
        {"_id": counter_id(SHELTER, CAMPAIGN, ITEM)}, {"$unset": {"on_hand_qty": ""}}
    )

    assert await _reserve("500") is ReserveResult.RESERVED


async def test_stock_reaches_every_campaign_asking_for_the_item(db: None) -> None:
    """A ledger records the shelter's shelf, which no single campaign owns a share of.

    Matches compute_needs, which shows the whole balance to every campaign. With more
    than one open campaign that under-books rather than over-books — for a ceiling,
    the safe direction.
    """
    other = "donation_campaign:02"
    await _seed()
    await seed_counter(
        shelter_code=SHELTER,
        campaign_id=other,
        item_id=ITEM,
        qty_target=Decimal("500"),
        now=NOW,
    )

    changed = await set_on_hand_qty(
        shelter_code=SHELTER, item_id=ITEM, qty=Decimal("450"), now=NOW
    )

    assert changed == 2
    assert await _reserve("60") is ReserveResult.NEED_FULL
    assert await _reserve("60", campaign=other) is ReserveResult.NEED_FULL


async def test_another_shelter_is_left_alone(db: None) -> None:
    await _seed()
    await seed_counter(
        shelter_code="SH002",
        campaign_id=CAMPAIGN,
        item_id=ITEM,
        qty_target=Decimal("500"),
        now=NOW,
    )

    await set_on_hand_qty(shelter_code=SHELTER, item_id=ITEM, qty=Decimal("500"), now=NOW)

    counter = await DonationNeedCounter.get(counter_id("SH002", CAMPAIGN, ITEM))
    assert counter is not None
    assert counter.on_hand_qty == Decimal("0")


def test_on_hand_decimals_sums_a_ledger_without_float_drift() -> None:
    # 0.1 + 0.2 in float is 0.30000000000000004, and this figure is compared against
    # Decimal128 quantities inside Mongo.
    assert on_hand_decimals(
        [
            {"item_id": ITEM, "qty": "0.1"},
            {"item_id": ITEM, "qty": "0.2"},
            {"item_id": None, "qty": "99"},
            {"item_id": "item:water", "qty": "not a number"},
        ]
    ) == {ITEM: Decimal("0.3"), "item:water": Decimal("0")}


async def test_refresh_on_hand_reads_the_ledger_and_writes_the_counters(db: None) -> None:
    await _seed()

    async def _docs(_database: str):
        for doc in (
            {"_id": "stock_ledger:1", "type": "stock_ledger", "item_id": ITEM, "qty": "200"},
            {"_id": "stock_ledger:2", "type": "stock_ledger", "item_id": ITEM, "qty": "70"},
            # A distribution out of the warehouse is a negative entry.
            {"_id": "stock_ledger:3", "type": "stock_ledger", "item_id": ITEM, "qty": "-20"},
            {"_id": "donation:1", "type": "donation", "item_id": ITEM, "qty": "999"},
        ):
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = _docs

    await refresh_on_hand(couch, SHELTER)

    counter = await DonationNeedCounter.get(counter_id(SHELTER, CAMPAIGN, ITEM))
    assert counter is not None
    assert counter.on_hand_qty == Decimal("250")


async def test_refresh_on_hand_skips_a_shelter_with_no_database(db: None) -> None:
    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=False)

    assert await refresh_on_hand(couch, SHELTER) == 0
