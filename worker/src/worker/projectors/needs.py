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

    all_campaigns = await _fetch_docs_by_prefix(couch, database, "donation_campaign:")
    campaigns = [
        doc
        for doc in all_campaigns
        if doc.get("type") == "donation_campaign"
        and doc.get("status") == "open"
        and doc.get("visible_on_home") is not False
    ]
    donations = [
        doc
        for doc in await _fetch_docs_by_prefix(couch, database, "donation:")
        if doc.get("type") == "donation"
    ]
    # T-22 closes a need on on-hand + reserved, so the warehouse has to be in hand
    # here too — the back-office board has counted it since CR-034.
    stock_ledgers = [
        doc
        for doc in await _fetch_docs_by_prefix(couch, database, "stock_ledger:")
        if doc.get("type") == "stock_ledger"
    ]
    catalog = await _load_catalog_map(couch)

    target_by_item: dict[str, float] = {}
    urgency_by_item: dict[str, str] = {}
    for camp in campaigns:
        camp_urg = camp.get("urgency")
        if not camp_urg and "[ด่วน]" in (camp.get("notes") or ""):
            camp_urg = "critical"
        elif not camp_urg:
            camp_urg = "normal"

        for need in camp.get("needs") or []:
            item_id = need.get("item_id")
            if not item_id:
                continue
            try:
                target_by_item[item_id] = target_by_item.get(item_id, 0.0) + float(
                    need.get("qty_target") or 0.0
                )
            except TypeError, ValueError:
                pass
            if camp_urg == "critical" or urgency_by_item.get(item_id) != "critical":
                urgency_by_item[item_id] = camp_urg

    remaining, _ = compute_needs(campaigns, donations, stock_ledgers)
    now = datetime.now(UTC)
    actions: list[tuple[ProjectionAction, dict[str, Any] | None]] = []

    # Candidates: all items that were ever configured in any campaign in this shelter
    candidate_item_ids = {
        need["item_id"]
        for c in all_campaigns
        for need in (c.get("needs") or [])
        if need.get("item_id")
    }

    # Delete any item that is no longer in remaining (e.g. campaign closed or hidden via visible_on_home)
    for item_id in sorted(candidate_item_ids):
        if item_id not in remaining:
            doc_id = f"{shelter_code}:item:{item_id.removeprefix('item:')}"
            actions.append(("delete", {"_id": doc_id}))

    for item_id, qty_open in remaining.items():
        try:
            qty_needed = float(qty_open)
        except TypeError, ValueError:
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
                    "qty_target": target_by_item.get(item_id, 0.0),
                    "urgency": urgency_by_item.get(item_id, "normal"),
                    "unit": details.get("unit", "unit"),
                    "updated_at": now,
                },
            )
        )
    return actions
