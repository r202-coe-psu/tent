"""`public_needs` quantities are Decimal end to end (#934, draft-public-needs-decimal).

The projector computes in ``Decimal``, rounds to four places half-up BEFORE the ``<= 0``
delete, and Mongo stores ``Decimal128`` — so ``0.1 + 0.2`` is ``0.3`` and a need met
exactly closes instead of lingering at ``1.1e-16``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from bson import Decimal128
from tent_model import PublicNeed
from tent_model.qty import format_qty, quantize_qty

from worker.mongo.need import apply_need
from worker.projectors.compute_needs import compute_needs, need_breakdown
from worker.projectors.needs import project_needs_for_shelter

SHELTER = "SH001"
ITEM = "item:rice"
CARD_ID = f"{SHELTER}:{ITEM}@-"


def _campaign(qty_target: str, **over) -> dict:
    return {
        "_id": "donation_campaign:01",
        "type": "donation_campaign",
        "status": "open",
        "needs": [{"item_id": ITEM, "qty_target": qty_target, "unit": "kg"}],
        **over,
    }


def _ledger(*quantities: str) -> list[dict]:
    return [
        {
            "_id": f"stock_ledger:{n}",
            "type": "stock_ledger",
            "item_id": ITEM,
            "qty": qty,
            "reason": "adjust",
        }
        for n, qty in enumerate(quantities)
    ]


def _couch(docs: list[dict]) -> AsyncMock:
    async def iter_all_docs(database: str):
        for doc in [] if database == "catalog" else docs:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(
        side_effect=lambda database: database != "catalog"
    )
    couch.iter_all_docs = iter_all_docs
    return couch


async def _project(docs: list[dict]) -> list[tuple[str, dict | None]]:
    return await project_needs_for_shelter(_couch(docs), SHELTER)


def _upserts(actions: list[tuple[str, dict | None]]) -> list[dict]:
    return [doc for action, doc in actions if action == "upsert" and doc]


def _legacy_double_row() -> dict:
    return {
        "_id": CARD_ID,
        "shelter_code": SHELTER,
        "item_id": ITEM,
        "drop_off_point_id": None,
        "item_name": "ข้าว",
        "category": "food",
        "qty_needed": 0.7,
        "qty_target": 1.0,
        "on_hand": 0.30000000000000004,
        "reserved": 0.0,
        "unit": "kg",
        "urgency": "normal",
        "updated_at": datetime.now(UTC),
    }


# --- qty helpers ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("20.0"), "20"),
        (Decimal("1E+2"), "100"),
        (Decimal("0.30"), "0.3"),
        (Decimal("0.00004"), "0"),
        (Decimal("0.00005"), "0.0001"),
        (Decimal("-40.0"), "-40"),
        (Decimal("1E-7"), "0"),
        (5.0, "5"),
        (1e-05, "0"),
        ("12.3456789", "12.3457"),
        (Decimal("NaN"), "0"),
        (Decimal("Infinity"), "0"),
        (None, "0"),
        ("garbage", "0"),
    ],
)
def test_format_qty_is_a_qty_str(value, expected: str):
    assert format_qty(value) == expected


def test_quantize_qty_rounds_half_up_and_guards_non_finite():
    assert quantize_qty(Decimal("0.00005")) == Decimal("0.0001")
    assert quantize_qty(Decimal("NaN")) == 0
    assert quantize_qty(Decimal("-Infinity")) == 0


# --- compute (pure) ------------------------------------------------------------------


def test_compute_needs_is_exact_where_float_drifts():
    remaining, _ = compute_needs([_campaign("1")], [], _ledger("0.1", "0.2"))

    assert remaining[ITEM] == Decimal("0.7")
    assert isinstance(remaining[ITEM], Decimal)


def test_need_breakdown_is_decimal():
    donations = [
        {
            "_id": "donation:01",
            "campaign_id": "donation_campaign:01",
            "status": "declared",
            "items": [{"item_id": ITEM, "qty": "0.1"}, {"item_id": ITEM, "qty": "0.2"}],
        }
    ]

    terms = need_breakdown([_campaign("1")], donations, _ledger("0.1", "0.2"))[ITEM]

    assert terms == {
        "qty_target": Decimal(1),
        "on_hand": Decimal("0.3"),
        "reserved": Decimal("0.3"),
    }


def test_non_finite_quantities_never_raise_and_count_as_zero():
    donations = [
        {
            "_id": "donation:01",
            "campaign_id": "donation_campaign:01",
            "status": "declared",
            "items": [
                {"item_id": ITEM, "qty": "NaN"},
                {"item_id": ITEM, "qty": "Infinity"},
            ],
        }
    ]

    remaining, _ = compute_needs(
        [_campaign("10")], donations, _ledger("NaN", "Infinity", "-Infinity", "4")
    )
    nan_target, _ = compute_needs([_campaign("NaN")], [], [])

    assert remaining[ITEM] == Decimal(6)
    assert nan_target[ITEM] == Decimal(0)


# --- projector -> Mongo --------------------------------------------------------------


async def test_ledger_01_plus_02_is_stored_as_decimal128_and_prints_03(db):
    docs = [_campaign("0.3"), *_ledger("0.1", "0.2")]
    actions = await _project(docs)
    assert _upserts(actions) == []  # target 0.3 is met exactly -> no card at all

    docs = [_campaign("1"), *_ledger("0.1", "0.2")]
    for action, payload in await _project(docs):
        await apply_need(action, payload)

    raw = await PublicNeed.get_pymongo_collection().find_one({"_id": CARD_ID})
    assert raw is not None
    assert raw["on_hand"] == Decimal128("0.3")
    assert raw["qty_needed"] == Decimal128("0.7")
    assert raw["qty_target"] == Decimal128("1")
    assert raw["reserved"] == Decimal128("0")
    for field in ("qty_needed", "qty_target", "on_hand", "reserved"):
        assert isinstance(raw[field], Decimal128)

    stored = await PublicNeed.get(CARD_ID)
    assert stored is not None
    assert format_qty(stored.on_hand) == "0.3"
    assert format_qty(stored.qty_needed) == "0.7"
    assert format_qty(stored.qty_target) == "1"


async def test_need_met_exactly_by_decimal_stock_is_deleted(db):
    old = _legacy_double_row()
    await PublicNeed.get_pymongo_collection().insert_one(old)

    # 0.9 + 0.1 against a target of 1 — float leaves 1.1e-16 and keeps the row.
    actions = await _project([_campaign("1"), *_ledger("0.9", "0.1")])
    assert _upserts(actions) == []
    for action, payload in actions:
        await apply_need(action, payload)

    assert await PublicNeed.get(CARD_ID) is None


async def test_remainder_below_the_stored_step_deletes_the_row(db):
    """0.00001 left would print as "0" and read closed, so it is not kept either."""
    actions = await _project([_campaign("1"), *_ledger("0.99999")])

    assert _upserts(actions) == []


async def test_legacy_double_row_is_rewritten_as_decimal128(db):
    collection = PublicNeed.get_pymongo_collection()
    await collection.insert_one(_legacy_double_row())
    assert isinstance(
        (await collection.find_one({"_id": CARD_ID}))["qty_needed"], float
    )

    for action, payload in await _project([_campaign("1"), *_ledger("0.1", "0.2")]):
        await apply_need(action, payload)

    raw = await collection.find_one({"_id": CARD_ID})
    assert raw["on_hand"] == Decimal128("0.3")  # was 0.30000000000000004
    for field in ("qty_needed", "qty_target", "on_hand", "reserved"):
        assert isinstance(raw[field], Decimal128)


async def test_non_finite_ledger_row_cannot_reach_mongo(db):
    actions = await _project([_campaign("5"), *_ledger("NaN", "Infinity", "2")])
    for action, payload in actions:
        await apply_need(action, payload)

    stored = await PublicNeed.get(CARD_ID)
    assert stored is not None
    assert stored.qty_needed == Decimal(3)
    assert stored.on_hand == Decimal(2)
