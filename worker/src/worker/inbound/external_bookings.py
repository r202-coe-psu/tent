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

Failure handling: one broken group or cancel row never skips the rest of a poll, and a
group whose CouchDB write keeps failing is retried with an in-memory exponential
backoff (``FailureTracker``; resets on restart, nothing is persisted) so it neither
hammers CouchDB nor floods the log every ``POLL_INTERVAL_SECONDS``.

Residual case (R5, not fixable without a new persisted field — a spec change): if the
process dies after the ``_bulk_docs`` of a group and the API then cancels *every*
still-``pending`` row of it, no ``pending`` row is left, so the group is never due
again and those evacuees stay ``pre_registered`` in CouchDB until staff cancel them.
While at least one row of the group is still ``pending``, the next pass cancels the
stranded stays (``_cancel_stranded_rows``).

The same gap applies when a row has to stay ``cancelled`` (its CID was re-booked, see
``_route_cancelled_row``) and the direct stay cancel fails on a CouchDB error: with no
``pending`` sibling left, nothing retries it.

The API changes the same rows concurrently (EXT-009), so every Mongo write here is a
conditional ``update_one`` on the observed state (``_transition``), never a Beanie
full-document ``save()``.

Never log ``cid`` / ``phone`` / names — booking ids and Couch ids only.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo.errors import DuplicateKeyError
from tent_model import ExternalBooking

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.ulid import new_ulid

logger = logging.getLogger(__name__)


class _ExceptionTypeOnly(logging.Filter):
    """Reduce every logged exception to its type name — never its message or traceback.

    ``bulk_docs`` / ``find`` errors can embed the request body or a document, i.e. a
    partner's CID / phone / name. Call sites use plain ``logger.exception(...)``; this
    filter guarantees by construction that nothing but ``(error=<Type>)`` is emitted.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.exc_info and record.exc_info[0] is not None:
            record.msg = f"{record.getMessage()} (error={record.exc_info[0].__name__})"
            record.args = None
            record.exc_info = None
            record.exc_text = None
        return True


logger.addFilter(_ExceptionTypeOnly())

#: Same cadence as the donation inbound loop — a partner is told "accepted" by the API
#: and the shelter should see the pre-registration within a few seconds.
POLL_INTERVAL_SECONDS = 3

#: A `committed=False` row older than this was abandoned by a crashed API (FR-33).
STAGED_TTL_SECONDS = 60

#: First retry delay after a failed CouchDB write; doubles per failure up to the cap.
BACKOFF_BASE_SECONDS = 6.0
BACKOFF_MAX_SECONDS = 180.0
#: A repeated failure/skip log line for the same booking is emitted at most this often.
LOG_THROTTLE_SECONDS = 60.0

HOUSEHOLD_SCHEMA_V = 6
# Evacuee schema_v history: 12 = CR-154 (gender nullable + registered_via "api"),
# 13 = `preferred_zone` CR-159 (not written by this worker), 14 = `booking_ref` CR-169.
EVACUEE_SCHEMA_V = 14
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


def _clock() -> float:
    """Monotonic seconds; a module function so tests can drive time."""
    return time.monotonic()


class FailureTracker:
    """In-memory per-key retry backoff and log throttle (resets on worker restart).

    Keys are opaque strings (``group:BK-…`` / ``cancel:BP-…`` / ``incomplete:BK-…``) —
    ids only, never PII. Nothing here is persisted, on purpose: a restart simply retries
    everything once, which is safe because every write is idempotent.
    """

    def __init__(self) -> None:
        self._failures: dict[str, int] = {}
        self._retry_at: dict[str, float] = {}
        self._logged_at: dict[str, float] = {}

    def ready(self, key: str) -> bool:
        return _clock() >= self._retry_at.get(key, 0.0)

    def failed(self, key: str) -> tuple[int, float]:
        """Record a failure; returns ``(consecutive failures, seconds until retry)``."""
        count = self._failures.get(key, 0) + 1
        delay = min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** (count - 1))
        self._failures[key] = count
        self._retry_at[key] = _clock() + delay
        return count, delay

    def succeeded(self, key: str) -> None:
        self._failures.pop(key, None)
        self._retry_at.pop(key, None)

    def should_log(self, key: str, interval: float = LOG_THROTTLE_SECONDS) -> bool:
        """True at most once per ``interval`` per key."""
        now = _clock()
        last = self._logged_at.get(key)
        if last is not None and now - last < interval:
            return False
        self._logged_at[key] = now
        return True

    def prune(self, live: set[str]) -> None:
        """Forget keys of rows/groups that are no longer due, so state cannot grow."""
        for key in [k for k in self._failures if k not in live]:
            self.succeeded(key)
        now = _clock()
        for key, at in list(self._logged_at.items()):
            if now - at >= LOG_THROTTLE_SECONDS:
                del self._logged_at[key]


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

    A group is stale when a ``pending`` row of it is still ``committed=False`` after
    ``STAGED_TTL_SECONDS`` — the API crashed mid-insert or mid-commit. Per ``booking_id``
    this runs in two phases:

    1. delete the stale staged rows (``committed=False``, ``pending``, older than the
       TTL), each guarded again in the delete so a row the API committed meanwhile
       survives;
    2. only if phase 1 deleted something, delete the group's remaining ``pending`` rows.
       The group is now permanently short of ``group_size`` rows, so the worker can never
       have processed it (``_persist_group`` skips incomplete groups) and any
       ``committed=True`` row left over from a half-applied commit flip still carries PII.
       The API's ``_commit_group`` checks ``matched_count == group_size``, so a sweep that
       races a slow commit makes the API fail instead of answering 201.

    ``state: "pending"`` is in the stale filter because staged rows are always pending —
    it lets the ``(state, updated_at)`` index serve the query. Terminal rows
    (``written`` / ``cancelled`` / ``rejected``) are never touched: they hold no PII and
    callers read their ``evacuee_id`` / ``household_id`` afterwards.

    The cutoff uses the worker clock while ``created_at`` comes from the API host's; skew
    only shifts the effective TTL slightly and is covered by the API's shortfall check.
    ``committed`` is matched with a literal ``False`` — rows from before CR-169 have no
    such field and must not be mistaken for staged ones. Logs ids and counts only.
    """
    collection = ExternalBooking.get_pymongo_collection()
    cutoff = datetime.now(UTC) - timedelta(seconds=STAGED_TTL_SECONDS)
    stale = {"committed": False, "state": "pending", "created_at": {"$lt": cutoff}}
    booking_ids = await collection.distinct("booking_id", stale)
    swept: list[str] = []
    total = 0
    for booking_id in booking_ids:
        staged = await collection.delete_many({"booking_id": booking_id, **stale})
        if not staged.deleted_count:
            continue
        rest = await collection.delete_many(
            {"booking_id": booking_id, "state": "pending"}
        )
        swept.append(booking_id)
        total += staged.deleted_count + rest.deleted_count
    if total:
        logger.warning(
            "Swept %d stale staged booking row(s) from booking_id(s) %s",
            total,
            ", ".join(swept),
        )
    return total


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
    CouchDB whether any household/evacuee id reserved by a ``pending`` or ``cancelled``
    row exists (the API may have cancelled a row whose docs a crashed pass had already
    written). Only called on the (rare) duplicate path.
    """
    if any(row.state == "written" for row in rows):
        return True
    ids = [
        value
        for row in rows
        if row.state in ("pending", "cancelled")
        for value in (row.household_id, row.evacuee_id)
        if value
    ]
    if not ids:
        return False
    found = await couch.find(database, {"_id": {"$in": ids}}, fields=["_id"], limit=1)
    return bool(found)


async def _reject_pending(booking_id: str) -> int:
    """Reject every still-``pending`` row of a group as duplicate, PII cleared (FR-21).

    One guarded ``update_many`` rather than a per-row loop, so a crash cannot leave the
    group half rejected for long; the rest is finished by `_persist_group`'s rejected-row
    check. A row the API cancelled meanwhile is not ``pending`` and stays cancelled.
    """
    result = await ExternalBooking.get_pymongo_collection().update_many(
        {"booking_id": booking_id, **_PENDING},
        {
            "$set": {
                "state": "rejected",
                "reject_reason": "duplicate",
                **_PII_CLEARED,
                "updated_at": datetime.now(UTC),
            }
        },
    )
    return result.modified_count


async def _cancel_stay(
    couch: CouchClient, database: str, booking: ExternalBooking, evacuee: dict[str, Any]
) -> bool:
    """Cancel a ``pre_registered`` stay like the staff app does (FR-53).

    Stay → ``cancelled``, then an ``audit`` doc and the household roll-up. Returns False
    only when the stay itself could not be written (caller retries); audit + household
    are best effort — the stay is the source of truth and the household status is
    derived from it (schema.md §1.3). Logs ids and the exception type only.
    """
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
        logger.exception(
            "Could not cancel evacuee for booking %s",
            _ref(booking),
        )
        return False

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
            "Cancel audit/household update failed for booking %s",
            _ref(booking),
        )
    return True


async def _cancel_stay_directly(
    couch: CouchClient, database: str, booking: ExternalBooking
) -> None:
    """Cancel the CouchDB stay of a row that must stay ``cancelled`` in Mongo.

    Used when the row cannot move to ``written`` + ``cancel_requested`` (the partner
    already re-booked the same CID, so the unique open-booking index refuses it).
    """
    try:
        evacuee = await couch.get_doc(database, booking.evacuee_id)
    except Exception:
        logger.exception(
            "Could not read evacuee for booking %s",
            _ref(booking),
        )
        return
    status = ((evacuee or {}).get("current_stay") or {}).get("status")
    if evacuee is not None and status == "pre_registered":
        await _cancel_stay(couch, database, booking, evacuee)


async def _route_cancelled_row(
    couch: CouchClient, database: str, booking: ExternalBooking
) -> None:
    """A ``cancelled`` row whose evacuee exists in CouchDB: get the stay cancelled.

    ``written`` + ``cancel_requested`` still reads CANCELLED to the partner (EXT-010) and
    the next poll cancels the stay (`_process_cancel`). If the partner has meanwhile
    re-booked the same CID (a new open row with the same ``cid_hash``), that transition
    violates the unique index — then the row stays ``cancelled`` and the stay is
    cancelled right here.
    """
    try:
        moved = await _transition(
            booking,
            {"state": "cancelled"},
            {"state": "written", "cancel_requested": True},
        )
    except DuplicateKeyError:
        logger.info(
            "Booking %s cancelled but its CID was re-booked — cancelling stay %s directly",
            _ref(booking),
            booking.evacuee_id,
        )
        await _cancel_stay_directly(couch, database, booking)
        return
    if moved:
        logger.info(
            "Booking %s cancelled during write — queued stay cancel for %s",
            _ref(booking),
            booking.evacuee_id,
        )
    else:
        logger.warning(
            "Booking %s moved during write; evacuee %s written but row not updated",
            _ref(booking),
            booking.evacuee_id,
        )


async def _mark_written(
    couch: CouchClient, booking: ExternalBooking, database: str
) -> None:
    """CAS one row `pending` → `written` + PII cleared, after its docs reached Couch."""
    if await _transition(booking, _PENDING, {"state": "written", **_PII_CLEARED}):
        logger.info(
            "Wrote booking %s to %s as %s", _ref(booking), database, booking.evacuee_id
        )
        return
    # The API cancelled the row while we were writing (it already cleared PII and kept
    # `cancel_reason`). The evacuee now exists in CouchDB, so the stay must be cancelled.
    await _route_cancelled_row(couch, database, booking)


async def _cancel_stranded_rows(
    couch: CouchClient, database: str, rows: list[ExternalBooking]
) -> None:
    """Cancel stays of ``cancelled`` rows whose evacuee reached CouchDB (R5).

    A crashed pass can leave docs in CouchDB for a row the API then cancelled
    (``pending`` → ``cancelled`` while the worker was down). Such a row is no longer
    ``pending``, so nothing else would ever cancel its stay. Only rows with reserved
    ids qualify, and only a stay still ``pre_registered`` is touched. This runs when the
    group is processed again, i.e. while at least one sibling row is still ``pending``;
    if the API cancelled *all* rows the group is never due again (see module docstring).
    """
    for row in rows:
        if row.state != "cancelled" or not row.evacuee_id:
            continue
        try:
            evacuee = await couch.get_doc(database, row.evacuee_id)
            status = ((evacuee or {}).get("current_stay") or {}).get("status")
            if evacuee is not None and status == "pre_registered":
                await _route_cancelled_row(couch, database, row)
        except Exception:
            logger.exception(
                "Could not check cancelled booking %s",
                _ref(row),
            )


def _group_key(booking_id: str) -> str:
    return f"group:{booking_id}"


async def _persist_group(
    couch: CouchClient, booking_id: str, *, health: FailureTracker | None = None
) -> bool:
    """Write a booking group's ``pending`` rows into ``shelter_{code}`` (FR-21, FR-34).

    False = retry next poll. The group is all-or-nothing up to the CouchDB write: one
    duplicate rejects every pending row; after that, rows are written in one
    ``_bulk_docs`` and each row transitions on its own result. ``health`` (the loop's
    tracker) backs off and throttles logs for repeated write failures.
    """
    health = health or FailureTracker()
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
        if health.should_log(f"incomplete:{booking_id}"):
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

    # R1: an earlier pass rejected the group as duplicate but died before rejecting every
    # row. The duplicate check below would not see it again (the rejected rows' CIDs are
    # cleared) and would write the rest — finish the rejection instead (FR-21).
    if any(
        row.state == "rejected" and row.reject_reason == "duplicate" for row in rows
    ):
        rejected = await _reject_pending(booking_id)
        logger.info(
            "Finished rejecting booking group %s as duplicate (%d row(s))",
            booking_id,
            rejected,
        )
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
        logger.exception(
            "Duplicate check failed for booking group %s",
            booking_id,
        )
        return False

    if duplicates and not reached_couch:
        rejected = await _reject_pending(booking_id)
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
        # Not a conflict: back off instead of retrying every poll.
        attempt, delay, log_it = _write_failed(health, booking_id)
        if log_it:
            logger.exception(
                "Bulk write failed for booking group %s (attempt %d, retry in %.0fs)",
                booking_id,
                attempt,
                delay,
            )
        return False

    by_id = {result.get("id"): result for result in results if isinstance(result, dict)}
    failures: list[str] = []
    for row in pending:
        outcomes = [by_id.get(row.household_id), by_id.get(row.evacuee_id)]
        if all(_bulk_row_ok(outcome) for outcome in outcomes):
            await _mark_written(couch, row, database)
            continue
        detail = ", ".join(
            f"{doc_id}={(by_id.get(doc_id) or {}).get('error') or 'missing'}"
            for doc_id in (row.household_id, row.evacuee_id)
            if not _bulk_row_ok(by_id.get(doc_id))
        )
        failures.append(f"{_ref(row)}: {detail}")

    # Docs reached CouchDB (this pass or an earlier one), so rows the API cancelled in
    # the meantime may have a live stay.
    await _cancel_stranded_rows(couch, database, rows)

    if failures:
        attempt, delay, log_it = _write_failed(health, booking_id)
        if log_it:
            for detail in failures:
                logger.error(
                    "Bulk write row failures for booking group %s (attempt %d, "
                    "retry in %.0fs): %s",
                    booking_id,
                    attempt,
                    delay,
                    detail,
                )
        return False
    return True


def _write_failed(health: FailureTracker, booking_id: str) -> tuple[int, float, bool]:
    """Back the group off; returns ``(attempt, retry delay, whether to log this time)``."""
    attempt, delay = health.failed(_group_key(booking_id))
    return attempt, delay, health.should_log(f"bulk:{booking_id}")


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
        logger.exception(
            "Could not read evacuee for booking %s",
            _ref(booking),
        )
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

    if status == "pre_registered" and not await _cancel_stay(
        couch, database, booking, evacuee
    ):
        return False

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


async def _run_poll(
    couch: CouchClient,
    due: list[ExternalBooking],
    health: FailureTracker,
    stop_event: asyncio.Event,
) -> None:
    """One poll over the due rows; a failing group or cancel row never skips the rest."""
    # A group is written as one unit, so its pending rows are handled together.
    groups: dict[str, None] = {}
    cancels: list[ExternalBooking] = []
    for booking in due:
        if booking.state == "pending":
            groups.setdefault(booking.booking_id)
        elif booking.state == "written":
            cancels.append(booking)
    health.prune(
        {_group_key(booking_id) for booking_id in groups}
        | {f"cancel:{booking.id}" for booking in cancels}
    )

    for booking_id in groups:
        if stop_event.is_set():
            break
        key = _group_key(booking_id)
        if not health.ready(key):
            continue
        try:
            ok = await _persist_group(couch, booking_id, health=health)
        except Exception:
            ok = False
            health.failed(key)
            if health.should_log(f"error:{key}"):
                logger.exception("Booking group %s failed", booking_id)
        if ok:
            health.succeeded(key)

    for booking in cancels:
        if stop_event.is_set():
            break
        key = f"cancel:{booking.id}"
        if not health.ready(key):
            continue
        try:
            ok = await _process_cancel(couch, booking)
        except Exception:
            ok = False
            if health.should_log(f"error:{key}"):
                logger.exception(
                    "Cancel of booking %s failed",
                    _ref(booking),
                )
        if ok:
            health.succeeded(key)
        else:
            health.failed(key)


async def run_external_booking_inbound_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    health = FailureTracker()
    while not stop_event.is_set():
        # Own try/except: a sweeper failure must not stop bookings being written.
        try:
            await sweep_stale_staged()
        except Exception:
            logger.exception("Staged external booking sweep failed")
        try:
            due = await _find_due()
        except Exception:
            logger.exception("Inbound external booking poll failed")
        else:
            await _run_poll(couch, due, health, stop_event)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
