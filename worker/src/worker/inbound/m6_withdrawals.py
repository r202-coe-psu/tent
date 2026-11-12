"""M6 central-warehouse withdrawals → shelter donations (draft CR — central warehouse M6 §1, §5).

Three jobs in one loop:

1. **Tick** — every ``m6_sync_interval_s`` POST FastAPI ``/v1/integrations/m6/sync`` (FastAPI
   polls RES-006 and sends the RES-007 outbox; the worker is the only scheduler and never
   holds M6 credentials).
2. **Apply** — every Mongo ``m6_withdrawals`` row with ``rev > applied_rev``:
   - ``in_transit`` / ``received`` without ``donation_id`` → create donation
     ``donation:m6-{request_code}`` (``channel: m6``, ``status: verifying``) in
     ``shelter_{code}`` unless it already exists, then ``$set donation_id``;
   - donation exists → mirror ``confirmed_at`` / ``confirm_error`` onto ``external``;
   - ``issued`` / ``rejected`` / ``cancelled`` → no donation.
   ``applied_rev`` is compare-and-set, so a newer snapshot is re-applied.
3. **Outbox** — a row with a donation, no ``confirmed_at`` and no ``m6_confirm_outbox`` row
   whose donation has become ``received`` gets one outbox row (``_id`` = request_code) that
   FastAPI then sends to M6 (RES-007).

Every write is idempotent (deterministic donation id, read-modify-write, CAS), so a crash
or a re-run only repeats no-ops. Logs carry ids only.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from pymongo.errors import DuplicateKeyError
from tent_model import M6ConfirmOutbox, M6Withdrawal

from worker.config import Settings
from worker.couch.client import CouchClient
from worker.inbound.external_bookings import FailureTracker, _ExceptionTypeOnly
from worker.masking import shelter_db_name
from worker.timeutil import iso_utc

logger = logging.getLogger(__name__)
logger.addFilter(_ExceptionTypeOnly())

CATALOG_DB = "catalog"
#: How often pending rows are applied. The M6 tick runs on its own, slower cadence.
POLL_INTERVAL_SECONDS = 5
SYNC_TIMEOUT_SECONDS = 60
WORKER_ACTOR = "m6:worker"
#: `donation` schema_v once it carries `channel: m6` / `external` (CR §5).
M6_DONATION_SCHEMA_V = 12

#: M6 statuses whose goods are on the way (or arrived) and so owe the shelter a donation.
DONATION_STATUSES = ("in_transit", "received")
ALL_RECEIVED_NOTE = "รับครบ"

#: sku → ``item_master`` id, per shelter.
ItemMap = dict[str, str]


def _now_iso() -> str:
    return iso_utc(datetime.now(UTC))


def _clock() -> float:
    return time.monotonic()


def donation_id_for(request_code: str) -> str:
    """Deterministic id → one donation per M6 request, however often the row is applied."""
    return f"donation:m6-{request_code}"


def _ts(value: Any) -> str | None:
    if isinstance(value, datetime):
        return iso_utc(value)
    return value or None


def received_lines(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Lines M6 actually sent: ``qty_fulfilled > 0``."""
    return [
        line for line in row.get("lines") or [] if (line.get("qty_fulfilled") or 0) > 0
    ]


def build_m6_donation_doc(
    row: dict[str, Any], item_map: ItemMap, now: str
) -> dict[str, Any]:
    """The ``channel: m6`` donation for one withdrawal snapshot. Pure.

    Items are the lines with ``qty_fulfilled > 0`` (``qty`` = what M6 sent). A line whose
    ``item_code`` is some ``item_master.sku`` carries that ``item_id``; any other keeps its
    M6 name as ``free_text`` and is matched by staff when received (CR-143).
    """
    warehouse = row.get("source_warehouse_name") or row["source_warehouse_code"]
    items: list[dict[str, Any]] = []
    for line in received_lines(row):
        item: dict[str, Any] = {}
        item_id = item_map.get(str(line["item_code"]))
        if item_id:
            item["item_id"] = item_id
        else:
            item["free_text"] = line["name"]
        item["qty"] = str(int(line["qty_fulfilled"]))
        item["unit"] = line["unit"]
        item["review_status"] = "approved"
        items.append(item)
    return {
        "_id": donation_id_for(row["request_code"]),
        "type": "donation",
        "schema_v": M6_DONATION_SCHEMA_V,
        "channel": "m6",
        "shelter_code": row["shelter_code"],
        "created_at": now,
        "updated_at": now,
        "declared_at": now,
        "created_by": WORKER_ACTOR,
        "booking_ref": row["request_code"],
        "kind": "items",
        "donor": {
            "name": f"คลังกลาง M6 · {warehouse}",
            "phone": None,
            "phone_hash": "",
        },
        "items": items,
        "status": "verifying",
        "external": {
            "system": "m6",
            "request_code": row["request_code"],
            "external_ref": row["_id"],
            "source_warehouse_code": row["source_warehouse_code"],
            "source_warehouse_name": row.get("source_warehouse_name"),
            "confirmed_at": _ts(row.get("confirmed_at")),
            "confirm_error": row.get("confirm_error") or None,
        },
    }


def patch_external(
    doc: dict[str, Any], row: dict[str, Any], now: str
) -> dict[str, Any] | None:
    """Donation with ``external.confirmed_at`` / ``confirm_error`` of the row, or ``None``. Pure."""
    external = dict(doc.get("external") or {})
    confirmed_at = _ts(row.get("confirmed_at"))
    confirm_error = row.get("confirm_error") or None
    if (
        external.get("confirmed_at") == confirmed_at
        and external.get("confirm_error") == confirm_error
    ):
        return None
    external["confirmed_at"] = confirmed_at
    external["confirm_error"] = confirm_error
    return {**doc, "external": external, "updated_at": now}


def last_receiver(
    donation: dict[str, Any], ledger_actors: list[str] | None = None
) -> dict[str, str] | None:
    """Who received the donation last, as RES-007 ``{name, username}``. Pure.

    The donation keeps no receiver of its own (CouchDB user names are the only identity
    staff writes carry), so in order: the staff member who closed it
    (``received_summary.closed_by``, unless ``system``), the last drop-off point receipt's
    ``received_by``, then the actor of the last ``stock_ledger`` row (``ledger_actors``,
    oldest first). ``name`` = ``username`` = that login — no display name is stored.
    """
    summary = donation.get("received_summary") or {}
    closed_by = summary.get("closed_by")
    if closed_by and closed_by != "system":
        return {"name": closed_by, "username": closed_by}
    for receipt in reversed(donation.get("point_receipts") or []):
        who = receipt.get("received_by") if isinstance(receipt, dict) else None
        if who:
            return {"name": who, "username": who}
    for who in reversed(ledger_actors or []):
        if who:
            return {"name": who, "username": who}
    return None


def _line_label(
    item: dict[str, Any] | None, item_id: str | None, names: dict[str, str]
) -> str:
    if item_id and item_id in names:
        return names[item_id]
    if item:
        return item.get("free_text") or item.get("item_id") or ""
    return item_id or ""


def names_by_item_id(row: dict[str, Any], donation: dict[str, Any]) -> dict[str, str]:
    """M6 line names for the donation's matched items (same order as ``received_lines``)."""
    items = donation.get("items") or []
    lines = received_lines(row)
    if len(items) != len(lines):
        return {}
    return {
        item["item_id"]: line["name"]
        for item, line in zip(items, lines, strict=True)
        if item.get("item_id")
    }


def confirm_note(donation: dict[str, Any], names: dict[str, str] | None = None) -> str:
    """RES-007 ``note``: shortfalls and turned-away lines, else ``รับครบ``. Pure."""
    names = names or {}
    summary = donation.get("received_summary") or {}
    by_id = {
        item["item_id"]: item
        for item in donation.get("items") or []
        if isinstance(item, dict) and item.get("item_id")
    }
    parts: list[str] = []
    for short in summary.get("shortfalls") or []:
        item_id = short.get("item_id")
        label = short.get("item_name") or _line_label(
            by_id.get(item_id), item_id, names
        )
        unit = (by_id.get(item_id) or {}).get("unit") or ""
        text = f"ขาด {label}".strip()
        if short.get("short"):
            text += f" {short['short']} {unit}".rstrip()
        if short.get("declared") is not None and short.get("counted") is not None:
            text += f" (ส่ง {short['declared']} นับได้ {short['counted']})"
        parts.append(text)
    for line in summary.get("items") or []:
        if not line.get("rejected"):
            continue
        item_id = line.get("item_id")
        label = line.get("free_text") or _line_label(by_id.get(item_id), item_id, names)
        text = f"ไม่รับ {label}".strip()
        reason = line.get("reject_reason")
        if reason:
            text += f": {reason}"
        parts.append(text)
    if not parts:
        return ALL_RECEIVED_NOTE
    return "; ".join(parts)


async def load_item_map(couch: CouchClient, shelter_code: str) -> ItemMap:
    """``item_master.sku → _id``: central ``catalog`` overridden by the shelter's own."""
    sku_map: ItemMap = {}
    for database in (CATALOG_DB, shelter_db_name(shelter_code)):
        if not await couch.database_exists(database):
            continue
        async for doc in couch.iter_all_docs(database):
            if doc.get("type") != "item_master" or doc.get("deactivated"):
                continue
            sku = doc.get("sku")
            if sku and doc.get("_id"):
                sku_map[str(sku)] = str(doc["_id"])
    return sku_map


async def _ensure_donation(
    couch: CouchClient,
    row: dict[str, Any],
    item_maps: dict[str, ItemMap],
    now: str,
) -> dict[str, Any] | None:
    """The row's donation: existing one reused, else created. ``None`` when nothing to create."""
    database = shelter_db_name(row["shelter_code"])
    doc_id = donation_id_for(row["request_code"])
    existing = await couch.get_doc(database, doc_id)
    if existing is not None:
        return existing
    if not received_lines(row):
        logger.warning(
            "m6 withdrawal has nothing fulfilled — no donation (external_ref=%s)",
            row["_id"],
        )
        return None
    if row["shelter_code"] not in item_maps:
        item_maps[row["shelter_code"]] = await load_item_map(couch, row["shelter_code"])
    doc = build_m6_donation_doc(row, item_maps[row["shelter_code"]], now)
    try:
        await couch.put_doc(database, doc, retry_conflict=False)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 409:
            raise
        # Created by an earlier run that died before `$set donation_id` — reuse it.
    return await couch.get_doc(database, doc_id)


async def apply_withdrawal(
    couch: CouchClient, row: dict[str, Any], item_maps: dict[str, ItemMap]
) -> None:
    """Write one `m6_withdrawals` row onto its donation. Raises on any write failure."""
    now = _now_iso()
    database = shelter_db_name(row["shelter_code"])
    donation_id = row.get("donation_id")
    if donation_id is None and row["status"] in DONATION_STATUSES:
        donation = await _ensure_donation(couch, row, item_maps, now)
        if donation is not None:
            donation_id = donation["_id"]
            await M6Withdrawal.get_pymongo_collection().update_one(
                {"_id": row["_id"]}, {"$set": {"donation_id": donation_id}}
            )
    if donation_id is None:
        return

    async def mutate(doc: dict[str, Any]) -> dict[str, Any] | None:
        return patch_external(doc, row, now)

    written = await couch.update_doc(database, donation_id, mutate)
    if written is None and await couch.get_doc(database, donation_id) is None:
        logger.warning(
            "m6 donation missing (external_ref=%s donation=%s)",
            row["_id"],
            donation_id,
        )


async def apply_pending(couch: CouchClient, tracker: FailureTracker) -> int:
    """Apply every row with unapplied changes. Returns how many rows were applied."""
    collection = M6Withdrawal.get_pymongo_collection()
    rows = await collection.find({"$expr": {"$gt": ["$rev", "$applied_rev"]}}).to_list(
        None
    )
    item_maps: dict[str, ItemMap] = {}  # one catalog read per shelter per pass
    applied = 0
    for row in rows:
        key = f"m6:{row['_id']}"
        if not tracker.ready(key):
            continue
        try:
            await apply_withdrawal(couch, row, item_maps)
        except Exception:
            count, delay = tracker.failed(key)
            logger.exception(
                "m6 withdrawal apply failed (external_ref=%s attempt=%d retry_in=%.0fs)",
                row["_id"],
                count,
                delay,
            )
            continue
        tracker.succeeded(key)
        # CAS: a newer snapshot that landed meanwhile keeps `rev > applied_rev` and is re-applied.
        await collection.update_one(
            {"_id": row["_id"], "applied_rev": row.get("applied_rev", 0)},
            {"$set": {"applied_rev": row["rev"]}},
        )
        applied += 1
    return applied


async def _ledger_actors(
    couch: CouchClient, database: str, donation_id: str
) -> list[str]:
    docs = await couch.find(
        database,
        {
            "type": "stock_ledger",
            "ref_id": donation_id,
            "item_id": {"$gt": None},
            "reason": "donation",
        },
        fields=["created_by", "created_at"],
        limit=200,
    )
    docs.sort(key=lambda d: str(d.get("created_at") or ""))
    return [str(d["created_by"]) for d in docs if d.get("created_by")]


async def queue_confirmations(couch: CouchClient, tracker: FailureTracker) -> int:
    """Queue RES-007 for every received donation not yet queued. Returns rows inserted."""
    rows = (
        await M6Withdrawal.get_pymongo_collection()
        .find({"donation_id": {"$ne": None}, "confirmed_at": None})
        .to_list(None)
    )
    if not rows:
        return 0
    queued = {
        doc["_id"]
        async for doc in M6ConfirmOutbox.get_pymongo_collection().find(
            {"_id": {"$in": [row["request_code"] for row in rows]}}, {"_id": 1}
        )
    }
    inserted = 0
    for row in rows:
        if row["request_code"] in queued:
            continue
        key = f"m6-outbox:{row['_id']}"
        if not tracker.ready(key):
            continue
        try:
            if await _queue_one(couch, row):
                inserted += 1
        except Exception:
            count, delay = tracker.failed(key)
            logger.exception(
                "m6 confirm queue failed (external_ref=%s attempt=%d retry_in=%.0fs)",
                row["_id"],
                count,
                delay,
            )
            continue
        tracker.succeeded(key)
    return inserted


async def _queue_one(couch: CouchClient, row: dict[str, Any]) -> bool:
    database = shelter_db_name(row["shelter_code"])
    donation = await couch.get_doc(database, row["donation_id"])
    if donation is None or donation.get("status") != "received":
        return False
    actors: list[str] = []
    if last_receiver(donation) is None:
        actors = await _ledger_actors(couch, database, row["donation_id"])
    receiver = last_receiver(donation, actors)
    # RES-007 needs someone to name; the shelter stands in when no staff login is recorded.
    received_by = [receiver] if receiver else [{"name": f"ศูนย์ {row['shelter_code']}"}]
    try:
        await M6ConfirmOutbox(
            id=row["request_code"],
            external_ref=row["_id"],
            shelter_code=row["shelter_code"],
            donation_id=row["donation_id"],
            received_by=received_by,
            note=confirm_note(donation, names_by_item_id(row, donation)),
            created_at=datetime.now(UTC),
        ).insert()
    except DuplicateKeyError:
        return False
    return True


async def tick_sync(settings: Settings, http: httpx.AsyncClient) -> None:
    """Ask FastAPI to refresh `m6_withdrawals` from M6 and send due confirmations."""
    if not settings.external_api_secret:
        return
    try:
        res = await http.post(
            f"{settings.fastapi_url.rstrip('/')}/v1/integrations/m6/sync",
            headers={"Authorization": f"Bearer {settings.external_api_secret}"},
        )
    except httpx.HTTPError as exc:
        logger.warning("m6 sync tick failed (%s)", type(exc).__name__)
        return
    if res.status_code >= 400:
        logger.warning("m6 sync tick answered HTTP %d", res.status_code)


async def run_m6_withdrawal_loop(
    couch: CouchClient, settings: Settings, *, stop_event: asyncio.Event
) -> None:
    tracker = FailureTracker()
    last_tick = float("-inf")
    async with httpx.AsyncClient(timeout=SYNC_TIMEOUT_SECONDS) as http:
        while not stop_event.is_set():
            if _clock() - last_tick >= settings.m6_sync_interval_s:
                last_tick = _clock()
                await tick_sync(settings, http)
            try:
                await apply_pending(couch, tracker)
            except Exception:
                logger.exception("m6 withdrawal apply pass failed")
            try:
                await queue_confirmations(couch, tracker)
            except Exception:
                logger.exception("m6 confirm queue pass failed")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SECONDS)
            except TimeoutError:
                pass
