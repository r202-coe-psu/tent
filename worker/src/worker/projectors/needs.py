"""Project open donation needs → public_needs (one doc per item)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.projectors.compute_needs import compute_needs

ProjectionAction = Literal["upsert", "delete"]


async def _fetch_docs_by_prefix(
    couch: CouchClient, database: str, prefix: str
) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    async for doc in couch.iter_all_docs(database):
        doc_id = doc.get("_id", "")
        if isinstance(doc_id, str) and doc_id.startswith(prefix):
            docs.append(doc)
    return docs


async def _load_catalog_map(couch: CouchClient) -> dict[str, dict[str, str]]:
    item_map: dict[str, dict[str, str]] = {}
    if not await couch.database_exists("catalog"):
        return item_map
    async for doc in couch.iter_all_docs("catalog"):
        if doc.get("type") == "supply_item" and doc.get("_id"):
            item_map[str(doc["_id"])] = {
                "name": str(doc.get("name") or doc["_id"]),
                "category": str(doc.get("category") or "other"),
                "unit": str(doc.get("unit") or "unit"),
            }
    return item_map


async def project_needs_for_shelter(
    couch: CouchClient, shelter_code: str
) -> list[tuple[ProjectionAction, dict[str, Any] | None]]:
    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        return []

    campaigns = [
        doc
        for doc in await _fetch_docs_by_prefix(couch, database, "donation_campaign:")
        if doc.get("type") == "donation_campaign" and doc.get("status") == "open"
    ]
    donations = [
        doc
        for doc in await _fetch_docs_by_prefix(couch, database, "donation:")
        if doc.get("type") == "donation"
    ]
    catalog = await _load_catalog_map(couch)

    remaining, _ = compute_needs(campaigns, donations)
    now = datetime.now(UTC)
    actions: list[tuple[ProjectionAction, dict[str, Any] | None]] = []

    for item_id, qty_open in remaining.items():
        try:
            qty_needed = float(qty_open)
        except (TypeError, ValueError):
            qty_needed = 0.0
        doc_id = f"{shelter_code}:item:{item_id.removeprefix('item:')}"
        if qty_needed <= 0:
            actions.append(("delete", {"_id": doc_id}))
            continue
        details = catalog.get(item_id, {})
        actions.append(
            (
                "upsert",
                {
                    "_id": doc_id,
                    "shelter_code": shelter_code,
                    "item_name": details.get("name", item_id),
                    "category": details.get("category", "other"),
                    "qty_needed": qty_needed,
                    "unit": details.get("unit", "unit"),
                    "updated_at": now,
                },
            )
        )
    return actions
