"""Aggregate `stock_ledger` → per-item stock balances (EXT-004/006, ADR 0002 §5).

Mirrors the staff-side reorder-threshold math (`frontend/src/lib/features/supply/
domain/threshold-calc.ts`) so the partner-facing `reorder_threshold` / `critical_items`
levels agree with what the back-office dashboard already shows.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, TypedDict

# M6's own enum (partner ODT EXT-004): food | genaral | medical-equipment | medication.
# `item_category`/`item_master.category` is free text on our side (schema.md §4.1/4.2,
# examples "food"/"medicine"/"hygiene") — map by best-effort keyword match; anything
# unrecognized falls back to `genaral` (M6's own catch-all spelling).
_DEFAULT_TYPE_CODE = "genaral"


def category_to_type_code(category: str | None) -> str:
    name = (category or "").strip().lower()
    if not name:
        return _DEFAULT_TYPE_CODE
    if "equipment" in name or "อุปกรณ์" in name:
        return "medical-equipment"
    if "food" in name or "อาหาร" in name:
        return "food"
    if "medic" in name or "ยา" in name:
        return "medication"
    return _DEFAULT_TYPE_CODE


class CatalogItem(TypedDict, total=False):
    name: str
    category: str | None
    unit: str
    sku: str | None
    reorder_level: float | None
    consumption_rate: str | None
    target_reserve_days: float | None
    timeframe: str | None


class ThresholdOverride(TypedDict, total=False):
    reorder_level: float | None
    consumption_rate: str | None
    target_reserve_days: float | None


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _stock_balances(stock_ledgers: list[dict[str, Any]]) -> dict[str, Decimal]:
    """Shelter balance per item — same sum as `worker.mongo.on_hand.on_hand_decimals`,
    duplicated locally (not imported) to keep this module free of the `worker.mongo`
    package and avoid a projectors ↔ mongo import cycle."""
    balance: dict[str, Decimal] = {}
    for entry in stock_ledgers:
        item_id = entry.get("item_id")
        if not item_id:
            continue
        balance[str(item_id)] = balance.get(str(item_id), Decimal(0)) + (
            _to_decimal(entry.get("qty")) or Decimal(0)
        )
    return balance


def calculate_reorder_threshold(
    occupancy: int,
    *,
    consumption_rate: str | None,
    target_reserve_days: float | None,
    timeframe: str | None,
) -> float | None:
    """``occupancy * consumption_rate * target_reserve_days`` (÷7 if weekly) — same
    formula as `calculateReorderLevel` (frontend `threshold-calc.ts`)."""
    rate = _to_decimal(consumption_rate)
    if rate is None or target_reserve_days is None:
        return None
    days = _to_decimal(target_reserve_days)
    if days is None:
        return None
    result = Decimal(occupancy) * rate * days
    if timeframe == "weekly":
        result = result / 7
    return float(result)


def resolve_reorder_threshold(
    *, occupancy: int, item: CatalogItem, override: ThresholdOverride | None
) -> float | None:
    if override:
        if (
            override.get("consumption_rate")
            and override.get("target_reserve_days") is not None
        ):
            computed = calculate_reorder_threshold(
                occupancy,
                consumption_rate=override.get("consumption_rate"),
                target_reserve_days=override.get("target_reserve_days"),
                timeframe=item.get("timeframe"),
            )
            if computed is not None:
                return computed
        if override.get("reorder_level") is not None:
            return float(override["reorder_level"])  # type: ignore[arg-type]

    computed = calculate_reorder_threshold(
        occupancy,
        consumption_rate=item.get("consumption_rate"),
        target_reserve_days=item.get("target_reserve_days"),
        timeframe=item.get("timeframe"),
    )
    if computed is not None:
        return computed
    return item.get("reorder_level")


def compute_shelter_stocks(
    stock_ledgers: list[dict[str, Any]],
    catalog: dict[str, CatalogItem],
    overrides: dict[str, ThresholdOverride],
    *,
    occupancy: int,
) -> list[dict[str, Any]]:
    """One payload per item ever ledgered — items with zero balance stay listed
    (a 0 on-hand figure is itself useful to a partner, unlike a public "need")."""
    balances = _stock_balances(stock_ledgers)
    payloads: list[dict[str, Any]] = []

    for item_id, qty in balances.items():
        item = catalog.get(item_id, {})
        override = overrides.get(item_id)
        threshold = resolve_reorder_threshold(
            occupancy=occupancy, item=item, override=override
        )
        payloads.append(
            {
                "item_id": item_id,
                "m6_reference_id": None,
                "m6_item_code": item.get("sku"),
                "name_th": item.get("name") or item_id,
                "type_code": category_to_type_code(item.get("category")),
                "unit_label": item.get("unit") or "unit",
                "unit_ratio": 1.0,
                "quantity_on_hand": float(qty),
                "source": "direct_donation",
                "reorder_threshold": threshold,
            }
        )
    return payloads
