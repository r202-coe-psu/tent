"""M5 transfers → CouchDB referrals (draft CR — referral M5 integration §4, D7, D9).

Two jobs in one loop:

1. **Tick** — every ``m5_sync_interval_s`` POST FastAPI ``/v1/integrations/m5/sync`` (FastAPI runs
   several processes, so the worker is the only scheduler). The worker never holds M5
   credentials.
2. **Apply** — every Mongo ``m5_transfers`` row with ``rev > applied_rev`` is written onto each
   referral in ``referral_ids`` (``central_ops``), then ``applied_rev`` is compare-and-set:
   - status mapping of CR §4 (``awaiting_review → sent``, ``pending``/``in_transit → accepted``,
     ``rejected``, ``arrived``/``cancelled → closed``), walking the state matrix forward only;
   - D7 repair: a referral still ``draft`` although M5 holds the transfer is first moved to
     ``sent`` with its ``external`` link;
   - D9: once the vehicle left (``in_transit``, or ``arrived`` if that was missed) each patient
     gets one ``leave_temporary`` movement in ``shelter_{code}`` and ``current_stay`` becomes
     ``temporary_leave`` — only from ``active`` / ``room_confirmed``.

Every write is idempotent (fixed movement ids, read-modify-write with conflict retry, CAS on
``applied_rev``), so a crash or a re-run only repeats no-ops. Logs carry ids only.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from tent_model import M5Transfer

from worker.config import Settings
from worker.couch.client import CouchClient
from worker.inbound.external_bookings import FailureTracker, _ExceptionTypeOnly
from worker.masking import shelter_db_name

logger = logging.getLogger(__name__)
logger.addFilter(_ExceptionTypeOnly())

CENTRAL_OPS_DB = "central_ops"
#: How often pending rows are applied. The M5 tick runs on its own, slower cadence.
POLL_INTERVAL_SECONDS = 5
SYNC_TIMEOUT_SECONDS = 60
WORKER_ACTOR = "m5:worker"
#: `referral` schema_v once it carries M5 fields (D15).
M5_REFERRAL_SCHEMA_V = 3

LEAVE_ELIGIBLE_STAY = ("active", "room_confirmed")
ARRIVED_CLOSE_REASON = "ผู้ป่วยถึงโรงพยาบาลปลายทางแล้ว (M5)"
CANCELLED_CLOSE_REASON = "M5 ยกเลิกใบส่งต่อ"

# Forward-only paths through the referral state matrix to reach each M5 status.
_PATHS: dict[str, dict[str, tuple[str, ...]]] = {
    "awaiting_review": {"draft": ("sent",)},
    "pending": {"draft": ("sent", "accepted"), "sent": ("accepted",)},
    "in_transit": {"draft": ("sent", "accepted"), "sent": ("accepted",)},
    "rejected": {"draft": ("sent", "rejected"), "sent": ("rejected",)},
    "arrived": {
        "draft": ("sent", "accepted", "closed"),
        "sent": ("accepted", "closed"),
        "accepted": ("closed",),
    },
    "cancelled": {
        "draft": ("sent", "closed"),
        "sent": ("closed",),
        "accepted": ("closed",),
        "rejected": ("closed",),
    },
}
_LEFT_SHELTER = ("in_transit", "arrived")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _clock() -> float:
    return time.monotonic()


def _bare(referral_id: str) -> str:
    return referral_id.removeprefix("referral:")


def leave_movement_id(referral_id: str) -> str:
    """Fixed id → one leave movement per referral, however often the row is applied."""
    return f"movement:m5_leave_temporary:{_bare(referral_id)}"


def _external(
    row: dict[str, Any], previous: dict[str, Any] | None, now: str
) -> dict[str, Any]:
    ext: dict[str, Any] = {
        **(previous or {}),
        "system": "m5",
        "external_ref": row["_id"],
        "code": row["code"],
        "status": row["status"],
        "last_synced_at": now,
    }
    review = row.get("review") or {}
    if review.get("by") or review.get("note") or review.get("at"):
        ext["review"] = {
            "note": review.get("note") or "",
            "by": review.get("by"),
            "at": review.get("at"),
        }
    original = row.get("original_destination") or {}
    if original.get("facility_id") is not None:
        ext["original_m5_facility_id"] = original["facility_id"]
    return ext


def apply_row_to_referral(
    doc: dict[str, Any], row: dict[str, Any], now: str
) -> dict[str, Any] | None:
    """New referral doc for this M5 snapshot, or ``None`` when nothing changes. Pure."""
    m5_status = row["status"]
    nxt = json.loads(json.dumps(doc))
    nxt["external"] = _external(row, doc.get("external"), now)
    nxt["schema_v"] = max(int(doc.get("schema_v") or 1), M5_REFERRAL_SCHEMA_V)

    # MOPH may approve to another hospital (TRF-004 `destination` vs `original_destination`).
    destination = row.get("destination") or {}
    if row.get("original_destination") and destination.get("facility_id") is not None:
        to_org = dict(nxt.get("to_org") or {})
        to_org["name"] = destination.get("name") or to_org.get("name")
        to_org["m5_facility_id"] = destination["facility_id"]
        nxt["to_org"] = to_org

    review = row.get("review") or {}
    timeline = dict(nxt.get("timeline") or {})
    for step in _PATHS.get(m5_status, {}).get(nxt["status"], ()):
        if step == "sent":
            timeline.setdefault("sent", {"at": now, "by": WORKER_ACTOR})
        elif step in ("accepted", "rejected"):
            by = f"m5:{review['by']}" if review.get("by") else WORKER_ACTOR
            timeline["responded"] = {"at": review.get("at") or now, "by": by}
            if review.get("note"):
                nxt["response_reason"] = review["note"]
        elif step == "closed":
            timeline["closed"] = {"at": now, "by": WORKER_ACTOR}
            nxt.setdefault(
                "close_reason",
                ARRIVED_CLOSE_REASON
                if m5_status == "arrived"
                else CANCELLED_CLOSE_REASON,
            )
        nxt["status"] = step
    nxt["timeline"] = timeline

    def _same(a: dict[str, Any], b: dict[str, Any]) -> bool:
        def strip(d: dict[str, Any]) -> dict[str, Any]:
            e = dict(d.get("external") or {})
            e.pop("last_synced_at", None)
            return {**d, "external": e, "_rev": None, "updated_at": None}

        return strip(a) == strip(b)

    if _same(doc, nxt):
        return None
    nxt["updated_at"] = now
    return nxt


async def _write_leave(
    couch: CouchClient, row: dict[str, Any], referral: dict[str, Any], now: str
) -> None:
    """D9: one `leave_temporary` movement + `current_stay = temporary_leave` per patient."""
    database = shelter_db_name(row["shelter_code"])
    evacuee_id = referral.get("evacuee_id")
    if not evacuee_id:
        return
    evacuee = await couch.get_doc(database, evacuee_id)
    if evacuee is None:
        return
    stay = evacuee.get("current_stay") or {}
    movement_id = leave_movement_id(referral["_id"])
    movement = await couch.get_doc(database, movement_id)
    if movement is None:
        if stay.get("status") not in LEAVE_ELIGIBLE_STAY:
            return  # already away / checked out — record nothing
        destination = row.get("destination") or {}
        await couch.put_doc(
            database,
            {
                "_id": movement_id,
                "type": "movement",
                "schema_v": 1,
                "shelter_code": evacuee.get("shelter_code") or row["shelter_code"],
                "created_at": now,
                "updated_at": now,
                "created_by": WORKER_ACTOR,
                "evacuee_id": evacuee_id,
                "action": "leave_temporary",
                "zone": stay.get("zone"),
                "destination": {
                    "kind": "hospital",
                    "detail": destination.get("name") or "",
                },
                "reason": f"ส่งต่อโรงพยาบาลผ่าน M5 ({row['code']})",
                "occurred_at": now,
            },
        )

    async def leave(current: dict[str, Any]) -> dict[str, Any] | None:
        cur = current.get("current_stay") or {}
        if cur.get("status") not in LEAVE_ELIGIBLE_STAY:
            return None
        return {
            **current,
            "current_stay": {
                "status": "temporary_leave",
                "zone": cur.get("zone"),
                "since": now,
            },
            "updated_at": now,
        }

    await couch.update_doc(database, evacuee_id, leave)


async def apply_transfer(couch: CouchClient, row: dict[str, Any]) -> None:
    """Write one `m5_transfers` row onto all its referrals. Raises on any write failure."""
    now = _now_iso()
    for referral_id in row.get("referral_ids") or []:

        async def mutate(doc: dict[str, Any]) -> dict[str, Any] | None:
            return apply_row_to_referral(doc, row, now)

        written = await couch.update_doc(CENTRAL_OPS_DB, referral_id, mutate)
        referral = written or await couch.get_doc(CENTRAL_OPS_DB, referral_id)
        if referral is None:
            logger.warning(
                "m5 referral missing (external_ref=%s referral=%s)",
                row["_id"],
                referral_id,
            )
            continue
        if row["status"] in _LEFT_SHELTER:
            await _write_leave(couch, row, referral, now)


async def apply_pending(couch: CouchClient, tracker: FailureTracker) -> int:
    """Apply every row with unapplied changes. Returns how many rows were applied."""
    collection = M5Transfer.get_pymongo_collection()
    rows = await collection.find({"$expr": {"$gt": ["$rev", "$applied_rev"]}}).to_list(
        None
    )
    applied = 0
    for row in rows:
        key = f"m5:{row['_id']}"
        if not tracker.ready(key):
            continue
        try:
            await apply_transfer(couch, row)
        except Exception:
            count, delay = tracker.failed(key)
            logger.exception(
                "m5 transfer apply failed (external_ref=%s attempt=%d retry_in=%.0fs)",
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


async def tick_sync(settings: Settings, http: httpx.AsyncClient) -> None:
    """Ask FastAPI to refresh `m5_transfers` from M5 (TRF-003/004)."""
    if not settings.external_api_secret:
        return
    try:
        res = await http.post(
            f"{settings.fastapi_url.rstrip('/')}/v1/integrations/m5/sync",
            headers={"Authorization": f"Bearer {settings.external_api_secret}"},
        )
    except httpx.HTTPError as exc:
        logger.warning("m5 sync tick failed (%s)", type(exc).__name__)
        return
    if res.status_code >= 400:
        logger.warning("m5 sync tick answered HTTP %d", res.status_code)


async def run_m5_transfer_loop(
    couch: CouchClient, settings: Settings, *, stop_event: asyncio.Event
) -> None:
    tracker = FailureTracker()
    last_tick = float("-inf")
    async with httpx.AsyncClient(timeout=SYNC_TIMEOUT_SECONDS) as http:
        while not stop_event.is_set():
            if _clock() - last_tick >= settings.m5_sync_interval_s:
                last_tick = _clock()
                await tick_sync(settings, http)
            try:
                await apply_pending(couch, tracker)
            except Exception:
                logger.exception("m5 transfer apply pass failed")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SECONDS)
            except TimeoutError:
                pass
