"""Project open donation needs → public_needs (one doc per item + drop-off point)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.projectors.compute_needs import compute_needs, need_breakdown

#: ``prune`` = delete every ``public_needs`` row of ``payload["shelter_code"]`` whose
#: ``_id`` is not in ``payload["keep_ids"]``.
ProjectionAction = Literal["upsert", "delete", "prune"]


async def _fetch_docs_by_prefix(
    couch: CouchClient, database: str, prefix: str
) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    async for doc in couch.iter_all_docs(database):
        doc_id = doc.get("_id", "")
        if isinstance(doc_id, str) and doc_id.startswith(prefix):
            docs.append(doc)
    return docs


def _item_master_entry(doc: dict[str, Any], doc_id: str) -> dict[str, str]:
    return {
        "name": str(doc.get("name") or doc_id),
        "category": str(doc.get("category") or "other"),
        # `base_unit` is authoritative; `unit` is the CR-013 transition field
        # kept for docs written before it existed.
        "unit": str(doc.get("base_unit") or doc.get("unit") or "unit"),
    }


async def _load_catalog_map(
    couch: CouchClient, shelter_database: str
) -> dict[str, dict[str, str]]:
    """Both catalog generations, keyed by exact ``_id``.

    ``item_master`` replaced ``supply_item`` (schema.md §4.2) and the migration has not
    run, so the catalog holds both — and §4.2's migration note requires clients to
    handle either prefix meanwhile. This map read ``supply_item`` only, so a campaign
    bound to an ``item_master:`` id fell through to the ``_id`` fallbacks below and the
    donor board showed the raw id ("item_master:canned-fish") with unit "unit".

    Keyed by exact id, never merged by name: the projection has to resolve whichever id
    the campaign actually carries.

    A shelter creates its own items in ``shelter_{code}``, not in ``catalog``, so those
    are read too and win over a central doc with the same id — the same precedence as
    ``listItemMasters`` and ``worker.mongo.stock._load_catalog``. Reading ``catalog``
    alone left a need for a shelter-made item showing its raw id on the donor board.
    """
    item_map: dict[str, dict[str, str]] = {}
    if await couch.database_exists("catalog"):
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
                item_map[str(doc_id)] = _item_master_entry(doc, str(doc_id))

    for doc in await _fetch_docs_by_prefix(couch, shelter_database, "item_master:"):
        if doc.get("type") != "item_master":
            continue
        doc_id = str(doc["_id"])
        if doc.get("deactivated"):
            item_map.pop(doc_id, None)
        else:
            item_map[doc_id] = _item_master_entry(doc, doc_id)
    return item_map


async def project_needs_for_shelter(
    couch: CouchClient, shelter_code: str
) -> list[tuple[ProjectionAction, dict[str, Any] | None]]:
    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        return []

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
    catalog = await _load_catalog_map(couch, database)

    now = datetime.now(UTC)
    actions: list[tuple[ProjectionAction, dict[str, Any] | None]] = []

    # Card = shelter + item_id + the need's drop_off_point_id (missing key = null).
    # Needs of several campaigns with the same key merge into one card (CR-206 A2).
    card_keys: set[tuple[str, str | None]] = set()
    urgency_by_card: dict[tuple[str, str | None], str] = {}
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
            key = (str(item_id), need.get("drop_off_point_id") or None)
            card_keys.add(key)
            # `qty_target` is NOT accumulated here — `need_breakdown` already sums it,
            # skipping needs staff force-closed, which a plain sum would still count.
            if camp_urg == "critical" or urgency_by_card.get(key) != "critical":
                urgency_by_card[key] = camp_urg

    keep_ids: list[str] = []
    for item_id, point_id in sorted(card_keys, key=lambda k: (k[0], k[1] or "")):
        # The shortage rule is pinned across three implementations, so it is not
        # touched: run it on campaign copies whose needs[] hold only this card's point.
        card_campaigns = [
            {
                **camp,
                "needs": [
                    need
                    for need in camp.get("needs") or []
                    if need.get("item_id") == item_id
                    and (need.get("drop_off_point_id") or None) == point_id
                ],
            }
            for camp in campaigns
        ]
        remaining, _ = compute_needs(card_campaigns, donations, stock_ledgers)
        breakdown = need_breakdown(card_campaigns, donations, stock_ledgers)
        try:
            qty_needed = float(remaining.get(item_id, 0))
        except TypeError, ValueError:
            qty_needed = 0.0
        if qty_needed <= 0:
            continue  # not kept -> the prune below removes any row it had
        doc_id = f"{shelter_code}:{item_id}@{point_id or '-'}"
        keep_ids.append(doc_id)
        details = catalog.get(item_id, {})
        terms = breakdown.get(item_id, {})
        actions.append(
            (
                "upsert",
                {
                    "_id": doc_id,
                    "shelter_code": shelter_code,
                    "item_id": item_id,
                    "drop_off_point_id": point_id,
                    "item_name": details.get("name", item_id),
                    "category": details.get("category", "other"),
                    "qty_needed": qty_needed,
                    "qty_target": terms.get("qty_target", 0.0),
                    "on_hand": terms.get("on_hand", 0.0),
                    "reserved": terms.get("reserved", 0.0),
                    "urgency": urgency_by_card.get((item_id, point_id), "normal"),
                    "unit": details.get("unit", "unit"),
                    "updated_at": now,
                },
            )
        )

    # Retract everything else of this shelter: closed/hidden campaigns, a need whose
    # point was edited (no CouchDB doc mentions the old point any more, so ids can't be
    # derived from CouchDB), and legacy `{shelter}:{item_id}` rows. Applied last, after
    # the upserts, by `apply_need`.
    actions.append(("prune", {"shelter_code": shelter_code, "keep_ids": keep_ids}))
    return actions
