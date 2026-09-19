"""Project open donation needs → public_needs (one doc per item)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.projectors.compute_needs import compute_needs, need_breakdown

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
    """Both catalog generations, keyed by exact ``_id``.

    ``item_master`` replaced ``supply_item`` (schema.md §4.2) and the migration has not
    run, so the catalog holds both — and §4.2's migration note requires clients to
    handle either prefix meanwhile. This map read ``supply_item`` only, so a campaign
    bound to an ``item_master:`` id fell through to the ``_id`` fallbacks below and the
    donor board showed the raw id ("item_master:canned-fish") with unit "unit".

    Keyed by exact id, never merged by name: the projection has to resolve whichever id
    the campaign actually carries.
    """
    item_map: dict[str, dict[str, str]] = {}
    if not await couch.database_exists("catalog"):
        return item_map
    async for doc in couch.iter_all_docs("catalog"):
        doc_id = doc.get("_id")
        if not doc_id:
            continue
        doc_type = doc.get("type")
        if doc_type == "supply_item":
            item_map[str(doc_id)] = {
                "name": str(doc.get("name") or doc_id),
                "category": str(doc.get("category") or "other"),
                "unit": str(doc.get("unit") or "unit"),
            }
        elif doc_type == "item_master" and not doc.get("deactivated"):
            item_map[str(doc_id)] = {
                "name": str(doc.get("name") or doc_id),
                "category": str(doc.get("category") or "other"),
                # `base_unit` is authoritative; `unit` is the CR-013 transition field
                # kept for docs written before it existed.
                "unit": str(doc.get("base_unit") or doc.get("unit") or "unit"),
            }
    return item_map


async def project_needs_for_shelter(
    couch: CouchClient, shelter_code: str
) -> list[tuple[ProjectionAction, dict[str, Any] | None]]:
    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        return []

    # Read once and keep the unfiltered list: the delete pass below needs every item
    # any campaign ever asked for, including the campaigns filtered out right here.
    all_campaigns = await _fetch_docs_by_prefix(couch, database, "donation_campaign:")
    # `visible_on_home` is the back-office "กำลังโชว์บนหน้าเว็บ / ซ่อนจากหน้าเว็บ" toggle
    # (schema.md §2.4, CR-034: "ควบคุมการโปรโมตแคมเปญบนหน้าแรก"). This projection is the
    # only public surface that reads campaign needs, so hiding a campaign has to happen
    # here — until it did, the toggle wrote a field nobody read and staff could not take
    # a campaign off the donor-facing board at all.
    #
    # Absent field = visible (CR-034 explicitly needs no backfill).
    campaigns = [
        doc
        for doc in all_campaigns
        if doc.get("type") == "donation_campaign"
        and doc.get("status") == "open"
        and doc.get("visible_on_home", True) is not False
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

    # Highest urgency any open campaign attaches to the item. `qty_target` is NOT
    # accumulated here — `need_breakdown` below already sums it, and does so skipping
    # needs staff force-closed, which a plain sum over `needs[]` would still count.
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
            if camp_urg == "critical" or urgency_by_item.get(item_id) != "critical":
                urgency_by_item[item_id] = camp_urg

    remaining, _ = compute_needs(campaigns, donations, stock_ledgers)
    # The terms behind the shortage, so the donor board can show what it is made of
    # instead of inventing a target and a received figure of its own.
    breakdown = need_breakdown(campaigns, donations, stock_ledgers)
    now = datetime.now(UTC)
    actions: list[tuple[ProjectionAction, dict[str, Any] | None]] = []

    # Candidates: all items that were ever configured in any campaign in this shelter
    candidate_item_ids = {
        need["item_id"]
        for c in all_campaigns
        for need in (c.get("needs") or [])
        if need.get("item_id")
    }

    # Retract any item no longer in `remaining` — campaign closed, or hidden with
    # `visible_on_home`. Keyed exactly like the upsert below (`{shelter}:{item_id}`,
    # the id carrying its own generation prefix). Re-adding `item:` here would aim the
    # delete at `SH001:item:item_master:x` while the row lives at
    # `SH001:item_master:x`, leaving the retracted need on the donor board forever.
    for item_id in sorted(candidate_item_ids):
        if item_id not in remaining:
            actions.append(("delete", {"_id": f"{shelter_code}:{item_id}"}))

    for item_id, qty_open in remaining.items():
        try:
            qty_needed = float(qty_open)
        except TypeError, ValueError:
            qty_needed = 0.0
        # The item id already carries its own generation prefix (`item:` or
        # `item_master:` — schema.md §4.2). This used to strip `item:` and re-add it,
        # which left `item_master:` ids doubled up as `SH001:item:item_master:x`.
        # Legacy ids are unaffected: `item:water` produced `SH001:item:water` before
        # and still does.
        doc_id = f"{shelter_code}:{item_id}"
        if qty_needed <= 0:
            actions.append(("delete", {"_id": doc_id}))
            continue
        details = catalog.get(item_id, {})
        terms = breakdown.get(item_id, {})
        actions.append(
            (
                "upsert",
                {
                    "_id": doc_id,
                    "shelter_code": shelter_code,
                    "item_name": details.get("name", item_id),
                    "category": details.get("category", "other"),
                    "qty_needed": qty_needed,
                    "qty_target": terms.get("qty_target", 0.0),
                    "on_hand": terms.get("on_hand", 0.0),
                    "reserved": terms.get("reserved", 0.0),
                    "urgency": urgency_by_item.get(item_id, "normal"),
                    "unit": details.get("unit", "unit"),
                    "updated_at": now,
                },
            )
        )
    return actions
