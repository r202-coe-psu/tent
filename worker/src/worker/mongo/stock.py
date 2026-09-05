"""Write projected shelter stock documents to MongoDB (EXT-004/006)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from tent_model import PublicShelter, ShelterStock

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.mongo.upsert import apply_document
from worker.projectors.stock import (
    CatalogItem,
    ThresholdOverride,
    compute_shelter_stocks,
)


async def apply_shelter_stock(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(ShelterStock, action, payload)


async def _load_catalog(couch: CouchClient) -> dict[str, CatalogItem]:
    """Item catalog (`catalog` DB) keyed by item id — `item_master` (current, schema.md
    §4.2) merged with legacy `supply_item` (still readable per §4.2 migration note)."""
    catalog: dict[str, CatalogItem] = {}
    if not await couch.database_exists("catalog"):
        return catalog

    async for doc in couch.iter_all_docs("catalog"):
        doc_id = doc.get("_id")
        if not doc_id:
            continue
        doc_type = doc.get("type")
        if doc_type == "item_master":
            catalog[str(doc_id)] = {
                "name": str(doc.get("name") or doc_id),
                "category": doc.get("category"),
                "unit": str(doc.get("base_unit") or "unit"),
                "sku": doc.get("SKU"),
                "reorder_level": None,
                "consumption_rate": doc.get("consumption_rate"),
                "target_reserve_days": doc.get("target_reserve_days"),
                "timeframe": doc.get("timeframe"),
            }
        elif doc_type == "supply_item":
            catalog[str(doc_id)] = {
                "name": str(doc.get("name") or doc_id),
                "category": doc.get("category"),
                "unit": str(doc.get("unit") or "unit"),
                "sku": None,
                "reorder_level": doc.get("reorder_level"),
                "consumption_rate": doc.get("consumption_rate"),
                "target_reserve_days": doc.get("target_reserve_days"),
                "timeframe": doc.get("timeframe"),
            }
    return catalog


async def _load_overrides(
    couch: CouchClient, shelter_code: str
) -> dict[str, ThresholdOverride]:
    """Per-shelter `stock_threshold_override` docs (CR-094) — shelter's own DB."""
    database = shelter_db_name(shelter_code)
    overrides: dict[str, ThresholdOverride] = {}
    async for doc in couch.iter_all_docs(database):
        if doc.get("type") == "stock_threshold_override" and doc.get("item_id"):
            overrides[str(doc["item_id"])] = {
                "reorder_level": doc.get("reorder_level"),
                "consumption_rate": doc.get("consumption_rate"),
                "target_reserve_days": doc.get("target_reserve_days"),
            }
    return overrides


async def refresh_shelter_stock(couch: CouchClient, shelter_code: str) -> int:
    """Recompute every `shelter_stocks` row for one shelter from its stock ledger.

    Full rescan on each relevant change, same pattern as `refresh_on_hand` — items
    are never deleted here even at zero balance (a 0 on-hand figure is itself useful
    to a partner, unlike a public donation "need")."""
    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        return 0

    ledgers = [
        doc
        async for doc in couch.iter_all_docs(database)
        if doc.get("type") == "stock_ledger"
        and str(doc.get("_id", "")).startswith("stock_ledger:")
    ]
    catalog = await _load_catalog(couch)
    overrides = await _load_overrides(couch, shelter_code)

    shelter = await PublicShelter.get(shelter_code)
    occupancy = shelter.occupancy_total if shelter is not None else 0

    payloads = compute_shelter_stocks(ledgers, catalog, overrides, occupancy=occupancy)
    now = datetime.now(UTC)
    for payload in payloads:
        item_id = payload["item_id"]
        doc_id = f"{shelter_code}:{item_id}"
        await apply_shelter_stock(
            "upsert",
            {
                "_id": doc_id,
                "shelter_code": shelter_code,
                "updated_at": now,
                **payload,
            },
        )
    return len(payloads)
