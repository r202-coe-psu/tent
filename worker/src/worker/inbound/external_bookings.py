"""Inbound loop — write partner (M2) bookings into the shelter CouchDB (CR-154 C6).

FastAPI accepts a booking into Mongo ``external_bookings`` (schema.md §9.7) and never
touches CouchDB (FR-54). This loop:

* ``pending`` → duplicate guard via ``_find`` (FR-50), then ``_bulk_docs`` a
  ``household`` + one ``evacuee`` at ``pre_registered`` (FR-51), then ``written`` and
  PII cleared (FR-52). Any failure leaves the booking ``pending`` for the next poll.
* ``written`` + ``cancel_requested`` → cancel the pre-registration if the evacuee is
  still ``pre_registered`` (FR-53), mirroring the staff
  ``cancelEvacueePreRegistration`` path (stay → ``cancelled`` + ``audit`` doc, and the
  household → ``cancelled`` once no member is left ``pre_registered``). Staff cancel
  writes no ``movement`` doc, so neither does this.

Never log ``cid`` / ``phone`` / names — booking ids and Couch ids only.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from tent_model import ExternalBooking

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.ulid import new_ulid

logger = logging.getLogger(__name__)

#: Same cadence as the donation inbound loop — a partner is told "accepted" by the API
#: and the shelter should see the pre-registration within a few seconds.
POLL_INTERVAL_SECONDS = 3

HOUSEHOLD_SCHEMA_V = 6
EVACUEE_SCHEMA_V = 12  # CR-154: gender nullable + registered_via api
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
    created_by: str,
    now: str,
) -> dict[str, Any]:
    """Couch ``evacuee`` (schema.md §1.1, schema_v 12) at ``pre_registered`` (FR-51)."""
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


async def _finish(booking: ExternalBooking, **changes: Any) -> None:
    for key, value in changes.items():
        setattr(booking, key, value)
    booking.updated_at = datetime.now(UTC)
    await booking.save()


async def _persist_booking(couch: CouchClient, booking: ExternalBooking) -> bool:
    """Write a ``pending`` booking into ``shelter_{code}``. False = retry next poll."""
    if booking.state != "pending":
        return False
    database = shelter_db_name(booking.shelter_code)
    if not await couch.database_exists(database):
        logger.warning(
            "Shelter database %s missing for booking %s", database, booking.id
        )
        return False
    if not booking.cid or not booking.first_name:
        # PII is only cleared on a terminal transition — a pending row without it
        # cannot be written and would loop forever, so surface it loudly.
        logger.error("Pending booking %s has no PII to write — skipping", booking.id)
        return False

    # Reserve ids before touching CouchDB so a retry re-uses them (conflict = written).
    if not booking.evacuee_id or not booking.household_id:
        booking.evacuee_id = booking.evacuee_id or f"evacuee:{new_ulid()}"
        booking.household_id = booking.household_id or f"household:{new_ulid()}"
        booking.updated_at = datetime.now(UTC)
        await booking.save()

    try:
        duplicates = await couch.find(
            database,
            {
                "type": "evacuee",
                "person_id.number": booking.cid,
                "current_stay.status": {"$in": list(HOLD_STATUSES)},
                "_id": {"$ne": booking.evacuee_id},
            },
            fields=["_id"],
            limit=1,
        )
    except Exception:
        logger.exception("Duplicate check failed for booking %s", booking.id)
        return False

    if duplicates:
        booking.clear_pii()
        await _finish(booking, state="rejected", reject_reason="duplicate")
        logger.info("Rejected booking %s as duplicate in %s", booking.id, database)
        return True

    now = _now_iso()
    actor = partner_actor(booking.module_name, booking.client_id)
    docs = [
        build_household_doc(
            household_id=booking.household_id,
            evacuee_id=booking.evacuee_id,
            shelter_code=booking.shelter_code,
            first_name=booking.first_name,
            created_by=actor,
            now=now,
        ),
        build_evacuee_doc(
            evacuee_id=booking.evacuee_id,
            household_id=booking.household_id,
            shelter_code=booking.shelter_code,
            cid=booking.cid,
            first_name=booking.first_name,
            last_name=booking.last_name,
            phone=booking.phone,
            created_by=actor,
            now=now,
        ),
    ]

    try:
        rows = await couch.bulk_docs(database, docs)
    except Exception:
        logger.exception("Bulk write failed for booking %s", booking.id)
        return False

    # `conflict` on a reserved id = already written by an earlier attempt.
    hard = [
        row
        for row in rows
        if isinstance(row, dict) and row.get("error") and row.get("error") != "conflict"
    ]
    if hard:
        detail = ", ".join(f"{row.get('id')}={row.get('error')}" for row in hard)
        logger.error("Bulk write row failures for booking %s: %s", booking.id, detail)
        return False

    booking.clear_pii()
    await _finish(booking, state="written")
    logger.info(
        "Wrote booking %s to %s as %s", booking.id, database, booking.evacuee_id
    )
    return True


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
            "Shelter database %s missing for booking %s", database, booking.id
        )
        return False

    try:
        evacuee = (
            await couch.get_doc(database, booking.evacuee_id)
            if booking.evacuee_id
            else None
        )
    except Exception:
        logger.exception("Could not read evacuee for booking %s", booking.id)
        return False

    status = ((evacuee or {}).get("current_stay") or {}).get("status")
    if evacuee is None or status not in ("pre_registered", "cancelled"):
        await _finish(booking, cancel_requested=False, reject_reason="not_cancellable")
        logger.info("Booking %s not cancellable (stay=%s)", booking.id, status)
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
            logger.exception("Could not cancel evacuee for booking %s", booking.id)
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
                "Cancel audit/household update failed for booking %s", booking.id
            )

    # status == "cancelled" here means an earlier attempt (or staff) already cancelled
    # the stay — the booking outcome is the same, so finish it instead of refusing.
    await _finish(booking, state="cancelled", cancel_requested=False)
    logger.info("Cancelled booking %s in %s", booking.id, database)
    return True


async def run_external_booking_inbound_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    while not stop_event.is_set():
        try:
            due = await ExternalBooking.find(
                {
                    "$or": [
                        {"state": "pending"},
                        {"state": "written", "cancel_requested": True},
                    ]
                }
            ).to_list()
            for booking in due:
                if stop_event.is_set():
                    break
                if booking.state == "pending":
                    await _persist_booking(couch, booking)
                else:
                    await _process_cancel(couch, booking)
        except Exception:
            logger.exception("Inbound external booking poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
