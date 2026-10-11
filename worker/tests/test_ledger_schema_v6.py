"""CR-143 §C (AC-C4) — the worker tolerates stock_ledger schema_v 6 rows.

schema_v 6 adds ``adjust_reason`` / ``note`` on ``reason='adjust'`` rows. Every worker
reader of ``stock_ledger`` (on-hand counters, shelter stock projection, needs board)
reads only ``item_id`` / ``qty`` / ``reason`` / ``ref_id`` from the raw Couch doc, so the
new fields must be ignored — not rejected — and a ledger that mixes schema_v 5 and 6
rows must still sum to the same balance.
"""

from __future__ import annotations

from decimal import Decimal

from worker.mongo.on_hand import on_hand_decimals
from worker.projectors.compute_needs import on_hand_by_item
from worker.projectors.stock import compute_shelter_stocks

ITEM = "item_master:rice"


def _row(
    qty: str, schema_v: int, reason: str = "receive", **extra: object
) -> dict[str, object]:
    return {
        "_id": f"stock_ledger:{schema_v}-{qty}-{reason}",
        "type": "stock_ledger",
        "schema_v": schema_v,
        "item_id": ITEM,
        "qty": qty,
        "unit": "kg",
        "reason": reason,
        **extra,
    }


# schema_v 5 (no adjust_reason), then 6 rows carrying the new fields incl. `merge`.
MIXED = [
    _row("100", 5, "donation", ref_id="donation:01J"),
    _row("-10", 5, "adjust", ref_id=None),
    _row("-5", 6, "adjust", ref_id=None, adjust_reason="damaged", note="ถุงฉีก"),
    _row("-2", 6, "adjust", ref_id=None, adjust_reason="merge", note="item_master:x"),
    _row("3", 6, "adjust", ref_id=None, adjust_reason="found"),
]


def test_on_hand_decimals_sums_mixed_schema_versions() -> None:
    assert on_hand_decimals(MIXED) == {ITEM: Decimal(86)}


def test_on_hand_by_item_sums_mixed_schema_versions() -> None:
    assert on_hand_by_item(MIXED) == {ITEM: 86.0}


def test_compute_shelter_stocks_ignores_adjust_reason_fields() -> None:
    payloads = compute_shelter_stocks(MIXED, {}, {}, occupancy=0)
    assert [(p["item_id"], p["quantity_on_hand"]) for p in payloads] == [(ITEM, 86.0)]
