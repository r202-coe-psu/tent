"""Inbound loop — write partner (M2) bookings into the shelter CouchDB (CR-154 C6).

FastAPI accepts a booking into Mongo ``external_bookings`` (schema.md §9.7) and never
touches CouchDB (FR-54). This loop:

* ``pending`` → a booking is a *group* of rows sharing ``booking_id`` (CR-169). The
  whole group is handled at once: one duplicate guard via ``_find`` over every CID
  (FR-21/FR-50; a hit rejects the whole group), then one ``_bulk_docs`` of a
  ``household`` + ``evacuee`` per row at ``pre_registered`` (FR-51, evacuee carries
  ``booking_ref``), then each row ``written`` and PII cleared (FR-52/FR-34). Any
  failure leaves the affected rows ``pending`` for the next poll.
* sweeper (FR-33) → drops groups the API never finished committing, so staged PII
  cannot linger after an API crash.
* ``written`` + ``cancel_requested`` → cancel the pre-registration if the evacuee is
  still ``pre_registered`` (FR-53), mirroring the staff
  ``cancelEvacueePreRegistration`` path (stay → ``cancelled`` + ``audit`` doc, and the
  household → ``cancelled`` once no member is left ``pre_registered``). Staff cancel
  writes no ``movement`` doc, so neither does this.

The API changes the same rows concurrently (EXT-009), so every Mongo write here is a
conditional ``update_one`` on the observed state (``_transition``), never a Beanie
full-document ``save()``.

Never log ``cid`` / ``phone`` / names — booking ids and Couch ids only.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from tent_model import ExternalBooking

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.ulid import new_ulid

logger = logging.getLogger(__name__)

#: Same cadence as the donation inbound loop — a partner is told "accepted" by the API
#: and the shelter should see the pre-registration within a few seconds.
POLL_INTERVAL_SECONDS = 3

#: A `committed=False` row older than this was abandoned by a crashed API (FR-33).
STAGED_TTL_SECONDS = 60

HOUSEHOLD_SCHEMA_V = 6
EVACUEE_SCHEMA_V = (
    14  # CR-169: booking_ref (13 = CR-154 gender nullable + registered_via api)
)
AUDIT_SCHEMA_V = 1

#: Stay statuses that hold a bed (schema.md §1.1 Forecast set) — a CID already in one
#: of these at the shelter means the booking is a duplicate (FR-50).
HOLD_STATUSES: tuple[str, ...] = (
    "pre_registered",
    "arriving",
    "active",
    "room_confirmed",
    "temporary_leave",
)

_CANCEL_REASON = "ยกเลิกการลงทะเบียนล่วงหน้า (partner API)"
_HOUSEHOLD_CANCEL_REASON = "ยกเลิกการลงทะเบียนครัวเรือนล่วงหน้า — ไม่มีสมาชิกค้าง pre_registered"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _ref(booking: ExternalBooking) -> str:
    """Log label for a row: its own id plus the partner-visible group id and position.

    Ids and counters only — never PII — so operators can grep logs by the `BK-…` id.
    """
    return f"{booking.id} (booking_id={booking.booking_id} person_seq={booking.person_seq})"


def partner_actor(module_name: str | None, client_id: str) -> str:
    """``created_by`` for partner writes — module when known, else client (FR-62)."""
    return f"partner:{module_name}" if module_name else f"partner:{client_id}"


def build_household_doc(
    *,
    household_id: str,
    evacuee_id: str,
    shelter_code: str,
    first_name: str,
    created_by: str,
    now: str,
) -> dict[str, Any]:
    """Couch ``household`` (schema.md §1.3) for a single-member partner booking."""
    return {
        "_id": household_id,
        "type": "household",
        "schema_v": HOUSEHOLD_SCHEMA_V,
        "shelter_code": shelter_code,
        "created_at": now,
        "updated_at": now,
        "created_by": created_by,
        "label": f"ครอบครัว{first_name}",
        "head_evacuee_id": evacuee_id,
        # Same literal the staff app and the unassigned-registration birth write.
        "status": "pre_registered",
        "checkout_destination": None,
        "municipality_zone": None,
        "community": None,
        "pets": [],
        "assets": None,
        "vehicles": [],
        "housing_type": None,
        "residence_landmark": None,
        "dorm_name": None,
        "dorm_building": None,
        "dorm_floor": None,
        "dorm_room": None,
        "address_no": None,
        "village_no": None,
        "subdistrict": None,
        "district": None,
        "province": None,
        "postal_code": None,
    }


def build_evacuee_doc(
    *,
    evacuee_id: str,
    household_id: str,
    shelter_code: str,
    cid: str,
    first_name: str,
    last_name: str | None,
    phone: str | None,
    booking_ref: str,
    created_by: str,
    now: str,
) -> dict[str, Any]:
    """Couch ``evacuee`` (schema.md §1.1, schema_v 14) at ``pre_registered`` (FR-51).

    ``booking_ref`` is the partner ``booking_id`` shared by every person of one group
    (CR-169 FR-60) — set on every new booking, single-person ones included.
    """
    return {
        "_id": evacuee_id,
        "type": "evacuee",
        "schema_v": EVACUEE_SCHEMA_V,
        "shelter_code": shelter_code,
        "created_at": now,
        "updated_at": now,
        "created_by": created_by,
        "first_name": first_name,
        "last_name": last_name or "",
        # M2 does not send gender — nullable since schema_v 12.
        "gender": None,
        "phone": phone,
        "person_id": {"cardType": "national_id", "number": cid},
        "country": "THAILAND",
        "vulnerable_groups": [],
        "special_needs": [],
        "household_id": household_id,
        "current_stay": {"status": "pre_registered", "zone": None, "since": now},
        "privacy": {"search_excluded": False},
        "registered_via": "api",
        "booking_ref": booking_ref,
    }


def build_audit_doc(
    *,
    target_type: str,
    target_id: str,
    reason: str,
    context: dict[str, Any],
    shelter_code: str,
    created_by: str,
    now: str,
) -> dict[str, Any]:
    """Couch ``audit`` entry — same shape the staff app's ``createAuditEntry`` writes."""
    return {
        "_id": f"audit:{new_ulid()}",
        "type": "audit",
        "schema_v": AUDIT_SCHEMA_V,
        "shelter_code": shelter_code,
        "created_at": now,
        "updated_at": now,
        "created_by": created_by,
        "action": "other",
        "target_type": target_type,
        "target_id": target_id,
        "reason": reason,
        "context": context,
        "occurred_at": now,
    }


_PII_CLEARED: dict[str, None] = {
    "cid": None,
    "first_name": None,
    "last_name": None,
    "phone": None,
}


async def _transition(
    booking: ExternalBooking, guard: dict[str, Any], changes: dict[str, Any]
) -> bool:
    """Conditionally ``$set`` ``changes`` on the booking row — never a full replace.

    The API mutates the same rows concurrently (EXT-009 cancel: ``pending`` →
    ``cancelled`` / ``written`` → ``cancel_requested``), so every worker write is a
    compare-and-set on the state it observed. Returns False when the guard no longer
    matches (the row moved under us); the in-memory copy is only updated on success.
    """
    now = datetime.now(UTC)
    result = await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": booking.id, **guard},
        {"$set": {**changes, "updated_at": now}},
    )
    if result.matched_count == 0:
        return False
    for key, value in changes.items():
        setattr(booking, key, value)
    booking.updated_at = now
    return True


_PENDING = {"state": "pending"}
_CANCEL_DUE = {"state": "written", "cancel_requested": True}


async def sweep_stale_staged() -> int:
    """Delete groups the API never finished committing (FR-33). Returns rows deleted.

    A group is stale when any of its rows is still ``committed=False`` after
    ``STAGED_TTL_SECONDS`` — the API crashed mid-insert or mid-commit. The commit flip
    (``update_many``) is not atomic on standalone Mongo, so such a group can also hold
    ``committed=True`` rows that still carry PII. The worker never processes an
    incomplete group (``_persist_group``), so every ``pending`` row of that
    ``booking_id`` is safe to drop. Terminal rows (``written`` / ``cancelled`` /
    ``rejected``) are never touched: they hold no PII and callers read their
    ``evacuee_id`` / ``household_id`` afterwards.

    ``committed`` is matched with a literal ``False`` — rows from before CR-169 have no
    such field and must not be mistaken for staged ones. Logs ids and counts only.
    """
    collection = ExternalBooking.get_pymongo_collection()
    cutoff = datetime.now(UTC) - timedelta(seconds=STAGED_TTL_SECONDS)
    booking_ids = await collection.distinct(
        "booking_id", {"committed": False, "created_at": {"$lt": cutoff}}
    )
    if not booking_ids:
        return 0
    result = await collection.delete_many(
        {"booking_id": {"$in": booking_ids}, "state": "pending"}
    )
    if result.deleted_count:
        logger.warning(
            "Swept %d stale staged booking row(s) from booking_id(s) %s",
            result.deleted_count,
            ", ".join(booking_ids),
        )
    return result.deleted_count


def _bulk_row_ok(row: dict[str, Any] | None) -> bool:
    """A `_bulk_docs` row succeeded; `conflict` on a reserved id = written earlier."""
    if not isinstance(row, dict):
        return False
    return not row.get("error") or row.get("error") == "conflict"


async def _group_reached_couch(
    couch: CouchClient, database: str, rows: list[ExternalBooking]
) -> bool:
    """True when any member of the group is already in CouchDB (retry after a crash).

    FR-21 only allows rejecting a group *before* anything was written. A previous
    attempt may have written some rows (``_bulk_docs`` is not atomic, and the process
    can die before the row transitions). If so, a duplicate now showing up must not
    reject the rest — it would orphan the persons already pre-registered — so the
    caller keeps writing. A ``written`` row is proof without a call; otherwise ask
    CouchDB whether any reserved household/evacuee id exists. Only called on the
    (rare) duplicate path.
    """
    if any(row.state == "written" for row in rows):
        return True
    ids = [
        value
        for row in rows
        if row.state == "pending"
        for value in (row.household_id, row.evacuee_id)
        if value
    ]
    if not ids:
        return False
    found = await couch.find(database, {"_id": {"$in": ids}}, fields=["_id"], limit=1)
    return bool(found)


async def _mark_written(booking: ExternalBooking, database: str) -> None:
    """CAS one row `pending` → `written` + PII cleared, after its docs reached Couch."""
    if await _transition(booking, _PENDING, {"state": "written", **_PII_CLEARED}):
        logger.info(
            "Wrote booking %s to %s as %s", _ref(booking), database, booking.evacuee_id
        )
        return

    # The API cancelled the row while we were writing (it already cleared PII and kept
    # `cancel_reason`). The evacuee now exists in CouchDB, so route the row through the
    # cancel path: `written` + `cancel_requested` still reads CANCELLED to the partner
    # (EXT-010) and the next poll cancels the stay.
    if await _transition(
        booking, {"state": "cancelled"}, {"state": "written", "cancel_requested": True}
    ):
        logger.info(
            "Booking %s cancelled during write — queued stay cancel for %s",
            _ref(booking),
            booking.evacuee_id,
        )
    else:
        logger.warning(
            "Booking %s left pending during write; evacuee %s written but row not updated",
            _ref(booking),
            booking.evacuee_id,
        )


async def _persist_group(couch: CouchClient, booking_id: str) -> bool:
    """Write a booking group's ``pending`` rows into ``shelter_{code}`` (FR-21, FR-34).

    False = retry next poll. The group is all-or-nothing up to the CouchDB write: one
    duplicate rejects every pending row; after that, rows are written in one
    ``_bulk_docs`` and each row transitions on its own result.
    """
    rows = (
        await ExternalBooking.find({"booking_id": booking_id})
        .sort("person_seq")
        .to_list()
    )
    if not rows:
        return True

    # FR-32: never act on a group the API has not finished committing. The commit flip
    # is not atomic, so a partly-flipped group is skipped until the sweeper drops it.
    committed = sum(1 for row in rows if row.committed is not False)
    if committed != rows[0].group_size:
        logger.info(
            "Booking group %s incomplete (%d/%d committed) — skipping",
            booking_id,
            committed,
            rows[0].group_size,
        )
        return False

    pending = [row for row in rows if row.state == "pending"]
    if not pending:
        return True

    database = shelter_db_name(pending[0].shelter_code)
    if not await couch.database_exists(database):
        logger.warning(
            "Shelter database %s missing for booking group %s", database, booking_id
        )
        return False
    if any(not row.cid or not row.first_name for row in pending):
        # PII is only cleared on a terminal transition — a pending row without it
        # cannot be written and would loop forever, so surface it loudly.
        logger.error(
            "Booking group %s has a pending row with no PII — skipping", booking_id
        )
        return False

    # Reserve ids before touching CouchDB so a retry re-uses them (conflict = written).
    # Guarded on `pending`: if the API cancelled a row since the poll read it, stop the
    # whole group here — nothing reaches CouchDB and the cancelled row is not resurrected.
    for row in pending:
        if row.evacuee_id and row.household_id:
            continue
        reserved = {
            "evacuee_id": row.evacuee_id or f"evacuee:{new_ulid()}",
            "household_id": row.household_id or f"household:{new_ulid()}",
        }
        if not await _transition(row, _PENDING, reserved):
            logger.info(
                "Booking %s left pending before write — skipping group", _ref(row)
            )
            return True

    try:
        duplicates = await couch.find(
            database,
            {
                "type": "evacuee",
                "person_id.number": {"$in": [row.cid for row in pending]},
                "current_stay.status": {"$in": list(HOLD_STATUSES)},
                # The group's own evacuees (a retry may already have written some).
                "_id": {"$nin": [row.evacuee_id for row in rows if row.evacuee_id]},
            },
            fields=["_id"],
            limit=1,
        )
        reached_couch = bool(duplicates) and await _group_reached_couch(
            couch, database, rows
        )
    except Exception:
        logger.exception("Duplicate check failed for booking group %s", booking_id)
        return False

    if duplicates and not reached_couch:
        rejected = 0
        for row in pending:
            if await _transition(
                row,
                _PENDING,
                {"state": "rejected", "reject_reason": "duplicate", **_PII_CLEARED},
            ):
                rejected += 1
        logger.info(
            "Rejected %d row(s) of booking group %s as duplicate in %s",
            rejected,
            booking_id,
            database,
        )
        return True
    if duplicates:
        logger.warning(
            "Booking group %s already partly written to %s — finishing despite a "
            "newly seen duplicate",
            booking_id,
            database,
        )

    now = _now_iso()
    docs: list[dict[str, Any]] = []
    for row in pending:
        actor = partner_actor(row.module_name, row.client_id)
        docs.append(
            build_household_doc(
                household_id=row.household_id,
                evacuee_id=row.evacuee_id,
                shelter_code=row.shelter_code,
                first_name=row.first_name,
                created_by=actor,
                now=now,
            )
        )
        docs.append(
            build_evacuee_doc(
                evacuee_id=row.evacuee_id,
                household_id=row.household_id,
                shelter_code=row.shelter_code,
                cid=row.cid,
                first_name=row.first_name,
                last_name=row.last_name,
                phone=row.phone,
                booking_ref=row.booking_id,
                created_by=actor,
                now=now,
            )
        )

    try:
        results = await couch.bulk_docs(database, docs)
    except Exception:
        logger.exception("Bulk write failed for booking group %s", booking_id)
        return False

    by_id = {result.get("id"): result for result in results if isinstance(result, dict)}
    all_ok = True
    for row in pending:
        outcomes = [by_id.get(row.household_id), by_id.get(row.evacuee_id)]
        if all(_bulk_row_ok(outcome) for outcome in outcomes):
            await _mark_written(row, database)
            continue
        all_ok = False
        detail = ", ".join(
            f"{doc_id}={(by_id.get(doc_id) or {}).get('error') or 'missing'}"
            for doc_id in (row.household_id, row.evacuee_id)
            if not _bulk_row_ok(by_id.get(doc_id))
        )
        logger.error("Bulk write row failures for booking %s: %s", _ref(row), detail)
    return all_ok


async def _cancel_household_if_empty(
    couch: CouchClient,
    database: str,
    *,
    household_id: str,
    evacuee_id: str,
    actor: str,
    now: str,
) -> None:
    household = await couch.get_doc(database, household_id)
    if not household or household.get("status") != "pre_registered":
        return
    members = await couch.find(
        database,
        {"type": "evacuee", "household_id": household_id},
        fields=["_id", "current_stay"],
        limit=200,
    )
    still_pre_registered = any(
        m.get("_id") != evacuee_id
        and (m.get("current_stay") or {}).get("status") == "pre_registered"
        for m in members
    )
    if still_pre_registered:
        return
    await couch.put_doc(
        database, {**household, "status": "cancelled", "updated_at": now}
    )
    await couch.put_doc(
        database,
        build_audit_doc(
            target_type="household",
            target_id=household_id,
            reason=_HOUSEHOLD_CANCEL_REASON,
            context={
                "previous_status": "pre_registered",
                "next_status": "cancelled",
                "triggered_by_evacuee_id": evacuee_id,
            },
            shelter_code=household.get("shelter_code") or "",
            created_by=actor,
            now=now,
        ),
    )


async def _process_cancel(couch: CouchClient, booking: ExternalBooking) -> bool:
    """Cancel a ``written`` booking's pre-registration (FR-53). False = retry next poll."""
    if booking.state != "written" or not booking.cancel_requested:
        return False
    database = shelter_db_name(booking.shelter_code)
    if not await couch.database_exists(database):
        logger.warning(
            "Shelter database %s missing for booking %s", database, _ref(booking)
        )
        return False

    try:
        evacuee = (
            await couch.get_doc(database, booking.evacuee_id)
            if booking.evacuee_id
            else None
        )
    except Exception:
        logger.exception("Could not read evacuee for booking %s", _ref(booking))
        return False

    status = ((evacuee or {}).get("current_stay") or {}).get("status")
    if evacuee is None or status not in ("pre_registered", "cancelled"):
        await _transition(
            booking,
            _CANCEL_DUE,
            {"cancel_requested": False, "reject_reason": "not_cancellable"},
        )
        logger.info("Booking %s not cancellable (stay=%s)", _ref(booking), status)
        return True

    if status == "pre_registered":
        now = _now_iso()
        actor = partner_actor(booking.module_name, booking.client_id)
        try:
            await couch.put_doc(
                database,
                {
                    **evacuee,
                    "current_stay": {"status": "cancelled", "zone": None, "since": now},
                    "updated_at": now,
                },
            )
        except Exception:
            logger.exception("Could not cancel evacuee for booking %s", _ref(booking))
            return False

        # Audit + household roll-up are best effort: the stay is the source of truth
        # and the household status is derived from it (schema.md §1.3).
        try:
            await couch.put_doc(
                database,
                build_audit_doc(
                    target_type="evacuee",
                    target_id=evacuee["_id"],
                    reason=_CANCEL_REASON,
                    context={
                        "previous_status": "pre_registered",
                        "next_status": "cancelled",
                        "household_id": evacuee.get("household_id"),
                        "booking_id": booking.booking_id,
                    },
                    shelter_code=booking.shelter_code,
                    created_by=actor,
                    now=now,
                ),
            )
            if evacuee.get("household_id"):
                await _cancel_household_if_empty(
                    couch,
                    database,
                    household_id=evacuee["household_id"],
                    evacuee_id=evacuee["_id"],
                    actor=actor,
                    now=now,
                )
        except Exception:
            logger.exception(
                "Cancel audit/household update failed for booking %s", _ref(booking)
            )

    # status == "cancelled" here means an earlier attempt (or staff) already cancelled
    # the stay — the booking outcome is the same, so finish it instead of refusing.
    await _transition(
        booking, _CANCEL_DUE, {"state": "cancelled", "cancel_requested": False}
    )
    logger.info("Cancelled booking %s in %s", _ref(booking), database)
    return True


async def _find_due() -> list[ExternalBooking]:
    """Rows to act on; `committed=False` rows are still being staged by the API (FR-32)."""
    return await ExternalBooking.find(
        {
            "committed": {"$ne": False},
            "$or": [
                {"state": "pending"},
                {"state": "written", "cancel_requested": True},
            ],
        }
    ).to_list()


async def run_external_booking_inbound_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    while not stop_event.is_set():
        # Own try/except: a sweeper failure must not stop bookings being written.
        try:
            await sweep_stale_staged()
        except Exception:
            logger.exception("Staged external booking sweep failed")
        try:
            due = await _find_due()
            # A group is written as one unit, so its pending rows are handled together.
            groups: dict[str, None] = {}
            for booking in due:
                if booking.state == "pending":
                    groups.setdefault(booking.booking_id)
            for booking_id in groups:
                if stop_event.is_set():
                    break
                await _persist_group(couch, booking_id)
            for booking in due:
                if stop_event.is_set():
                    break
                if booking.state == "written":
                    await _process_cancel(couch, booking)
        except Exception:
            logger.exception("Inbound external booking poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
