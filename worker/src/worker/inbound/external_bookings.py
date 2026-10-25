"""Inbound loop — write partner (M2) bookings into the shelter CouchDB (CR-154 C6).

FastAPI accepts a booking into Mongo ``external_bookings`` (schema.md §9.7) and never
touches CouchDB (FR-54). This loop:

* ``pending`` → a booking is a *group* of rows sharing ``booking_id`` (CR-169). The
  whole group is handled at once: one duplicate guard via ``_find`` over every CID
  (FR-21/FR-50; a hit rejects the whole group — unless a crashed earlier attempt already
  wrote part of it, then only the persons whose own CID is duplicated are rejected — and
  their already-written stay is cancelled — and the rest is written), then one ``_bulk_docs`` of a
  ``household`` + ``evacuee`` per row at ``pre_registered`` (FR-51, evacuee carries
  ``booking_ref``), then each row ``written`` and PII cleared (FR-52/FR-34). Any
  failure leaves the affected rows ``pending`` for the next poll.
* sweeper (FR-33) → drops groups the API never finished committing, so staged PII
  cannot linger after an API crash.
* ``written`` + ``cancel_requested`` → cancel the pre-registration if the evacuee is
  still ``pre_registered`` (FR-53), mirroring the staff
  ``cancelEvacueePreRegistration`` path (stay → ``cancelled`` + ``audit`` doc, and the
  household → ``cancelled`` once no member is left ``pre_registered``). Staff cancel
  writes no ``movement`` doc, so neither does this. A flag that still carries a
  ``cancel_flag_token`` belongs to an EXT-009 request that has not finished and is
  never acted on (see ``revert_abandoned_cancel_flags``).
* abandoned cancel flags → a ``cancel_flag_token`` older than
  ``CANCEL_FLAG_TTL_SECONDS`` is a request that died or failed to revert its flag; the
  flag is reverted without cancelling anything (the partner never got a 200).

Failure handling: one broken group or cancel row never skips the rest of a poll, and a
group whose CouchDB write keeps failing is retried with an in-memory exponential
backoff (``FailureTracker``; resets on restart, nothing is persisted) so it neither
hammers CouchDB nor floods the log every ``POLL_INTERVAL_SECONDS``.

Residual case (R5): if the process dies after the ``_bulk_docs`` of a group and the API
then cancels *every* still-``pending`` row of it, no ``pending`` row is left, so the group
is never due again. The reconcile pass (``reconcile_terminal_bookings``, #613) closes this:
it reads the reserved ``evacuee_id`` / ``household_id`` of every terminal row directly and
cancels the stays still ``pre_registered``, so it no longer depends on a ``pending``
sibling. While at least one row of the group is still ``pending``, the next pass also
cancels the stranded stays (``_cancel_stranded_rows``).

The same gap applies when a row stays ``cancelled`` / ``rejected`` and the direct stay
cancel fails on a CouchDB error (a stranded row, a row the API cancelled during the write,
or a row rejected as duplicate after its docs reached CouchDB — see
``_cancel_stranded_rows`` / ``_mark_written`` / ``_reject_duplicated_rows``). While a
``pending`` sibling is left, the next pass retries that stay cancel for both ``cancelled``
and D4-``rejected`` rows (``_cancel_stranded_rows``); the reconcile pass (#613) retries it
for every terminal row that has not been reconciled yet.

The API changes the same rows concurrently (EXT-009), so every Mongo write here is a
conditional ``update_one`` on the observed state (``_transition``), never a Beanie
full-document ``save()``.

Never log ``cid`` / ``phone`` / names — booking ids and Couch ids only.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from tent_model import ExternalBooking
from tent_model.evacuee_consent import EVACUEE_SCHEMA_V

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.ulid import new_ulid

logger = logging.getLogger(__name__)


class _ExceptionTypeOnly(logging.Filter):
    """Replace a logged exception by its type and where it was raised.

    ``bulk_docs`` / ``find`` errors can embed the request body or a document, i.e. a
    partner's CID / phone / name. Call sites use plain ``logger.exception(...)``. For such
    a record this filter keeps the log call's own format string and its arguments (as the
    message), appends ``(error=<Type> at <file>:<function>:<line>)`` and drops everything
    that came from the exception: its message, the traceback and every variable value
    (only the innermost frame's location is kept so an operator can still find the line).

    What it does NOT cover is the log call's own arguments: those are emitted as given.
    Safety therefore relies on every call site passing ids only (booking / Couch ids,
    counts, database names) and never a CID, phone or name.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.exc_info and record.exc_info[0] is not None:
            error = record.exc_info[0].__name__
            traceback = record.exc_info[2]
            while traceback is not None and traceback.tb_next is not None:
                traceback = traceback.tb_next
            if traceback is not None:
                code = traceback.tb_frame.f_code
                error += f" at {os.path.basename(code.co_filename)}:{code.co_name}:{traceback.tb_lineno}"
            record.msg = f"{record.getMessage()} (error={error})"
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

#: A ``cancel_flag_token`` older than this belongs to an EXT-009 request that died or could
#: not revert its flag (CR-169 decision sync 2026-10-17, review round 2 of PR #635). The API
#: has no hold-time limit on its flags (a 60 s rule was rejected, review round 3), so a live
#: request whose token clear runs past this TTL (Mongo slower than about a minute, or host
#: clock skew) may have its flags reverted here while it answers 200: an accepted residual,
#: closed only by #616.
CANCEL_FLAG_TTL_SECONDS = 120

#: First retry delay after a failed CouchDB write; doubles per failure up to the cap.
BACKOFF_BASE_SECONDS = 6.0
BACKOFF_MAX_SECONDS = 180.0
#: A repeated failure/skip log line for the same booking is emitted at most this often.
LOG_THROTTLE_SECONDS = 60.0
#: ``failed`` stops counting here; the exponent stops growing long before (6 * 2**16 is
#: already far above the cap) so the delay maths can never overflow.
_MAX_TRACKED_FAILURES = 10_000
_MAX_BACKOFF_EXPONENT = 16

HOUSEHOLD_SCHEMA_V = 6
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

#: Stay statuses that keep a household alive (schema.md §1.3 derive rules 2-4, CR-169 #613:
#: a household is cancelled only when no member is still held): HOLD_STATUSES plus
#: ``kiosk_registered``.
_HOUSEHOLD_LIVE_STATUSES: tuple[str, ...] = (*HOLD_STATUSES, "kiosk_registered")

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
        # Both the stored count and the exponent are clamped: an unbounded
        # ``2 ** (count - 1)`` overflows a float after ~1024 failures (~51 h of retries
        # for a permanently failing group) and the error would kill the inbound task.
        count = min(self._failures.get(key, 0) + 1, _MAX_TRACKED_FAILURES)
        delay = min(
            BACKOFF_MAX_SECONDS,
            BACKOFF_BASE_SECONDS * 2 ** min(count - 1, _MAX_BACKOFF_EXPONENT),
        )
        self._failures[key] = count
        self._retry_at[key] = _clock() + delay
        return count, delay

    def keys(self, prefix: str) -> list[str]:
        """Tracked keys starting with ``prefix`` — in backoff or not."""
        return [key for key in self._failures if key.startswith(prefix)]

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
    """Couch ``evacuee`` (schema.md §1.1) at ``pre_registered`` (FR-51), without ``consent``.

    ``booking_ref`` is the partner ``booking_id`` shared by every person of one group
    (CR-169 FR-60) — set on every new booking, single-person ones included. Partner
    bookings have no consent block; consent is collected at report-in (PDPA FR-44).
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
    doc_id: str | None = None,
) -> dict[str, Any]:
    """Couch ``audit`` entry — same shape the staff app's ``createAuditEntry`` writes.

    ``doc_id`` is set only for the partner cancel audits (`_stay_audit` /
    `_household_audit`): a deterministic id makes the write idempotent, so the reconcile
    pass can tell whether the audit of a cancel it finds already done exists (#613).
    """
    return {
        "_id": doc_id or f"audit:{new_ulid()}",
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


def _stay_audit_id(row_id: str) -> str:
    """Deterministic id of the audit of a partner stay cancel (one per booking row)."""
    return f"audit:ext-cancel-stay:{row_id}"


def _household_audit_id(household_id: str) -> str:
    """Deterministic id of the audit of a partner household cancel (one per household)."""
    return f"audit:ext-cancel-household:{household_id}"


def _stay_audit(
    booking: ExternalBooking, evacuee_id: str, household_id: str | None, now: str
) -> dict[str, Any]:
    return build_audit_doc(
        target_type="evacuee",
        target_id=evacuee_id,
        reason=_CANCEL_REASON,
        context={
            "previous_status": "pre_registered",
            "next_status": "cancelled",
            "household_id": household_id,
            "booking_id": booking.booking_id,
        },
        shelter_code=booking.shelter_code,
        created_by=partner_actor(booking.module_name, booking.client_id),
        now=now,
        doc_id=_stay_audit_id(booking.id),
    )


def _household_audit(
    household_id: str, shelter_code: str, evacuee_id: str | None, actor: str, now: str
) -> dict[str, Any]:
    return build_audit_doc(
        target_type="household",
        target_id=household_id,
        reason=_HOUSEHOLD_CANCEL_REASON,
        context={
            "previous_status": "pre_registered",
            "next_status": "cancelled",
            "triggered_by_evacuee_id": evacuee_id,
        },
        shelter_code=shelter_code,
        created_by=actor,
        now=now,
        doc_id=_household_audit_id(household_id),
    )


async def _write_audit_once(
    couch: CouchClient, database: str, doc: dict[str, Any]
) -> bool:
    """Write a deterministic-id audit doc unless it is already there. True = written now.

    The existence check keeps `put_doc` from overwriting an audit an earlier pass wrote.
    """
    if await couch.get_doc(database, doc["_id"]) is not None:
        return False
    await couch.put_doc(database, doc)
    return True


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


# Outcomes of `_cancel_stay`.
_CANCELLED = "cancelled"
_CHANGED = "changed"
_FAILED = "failed"

_PENDING = {"state": "pending"}
# `cancel_flag_token: None` also matches rows without the field (flags set before #612).
# A tokened flag is still owned by an in-flight EXT-009 request, which may yet revert it:
# acting on it could cancel a stay although the partner gets a 409/500 (CR-169 decision
# sync 2026-10-17, review round 2 of PR #635). The selector and every transition guard
# share this filter so they cannot drift apart.
_CANCEL_DUE = {"state": "written", "cancel_requested": True, "cancel_flag_token": None}


async def revert_abandoned_cancel_flags() -> int:
    """Revert ``cancel_requested`` flags whose request token is stale. Returns rows reverted.

    An EXT-009 request clears its token when it succeeds or when it reverts its own flag.
    A token still set after ``CANCEL_FLAG_TTL_SECONDS`` means the request's revert kept
    failing or its process died: the partner never got a 200, so the flag is undone
    (``cancel_requested=False``, reason/token/set time cleared) and nothing is cancelled in
    CouchDB. Each write is guarded on the token observed here, so a request that finishes
    meanwhile (its commit or revert clears the token first) is left alone, and an API revert
    racing this one writes the same values.

    Age is taken from ``cancel_flag_set_at`` (API clock vs. worker clock; skew only shifts
    the effective TTL). A token without a set time (rows flagged before the field existed)
    falls back to ``updated_at``, so such a row cannot stay tokened forever. Logs booking
    ids only.
    """
    collection = ExternalBooking.get_pymongo_collection()
    cutoff = datetime.now(UTC) - timedelta(seconds=CANCEL_FLAG_TTL_SECONDS)
    stale = await collection.find(
        {
            "state": "written",
            "cancel_requested": True,
            "cancel_flag_token": {"$ne": None},
            "$or": [
                {"cancel_flag_set_at": {"$lt": cutoff}},
                {"cancel_flag_set_at": None, "updated_at": {"$lt": cutoff}},
            ],
        },
        {"_id": 1, "booking_id": 1, "cancel_flag_token": 1},
    ).to_list()
    reverted: list[str] = []
    for row in stale:
        result = await collection.update_one(
            {
                "_id": row["_id"],
                "state": "written",
                "cancel_requested": True,
                "cancel_flag_token": row["cancel_flag_token"],
            },
            {
                "$set": {
                    "cancel_requested": False,
                    "cancel_reason": None,
                    "cancel_flag_token": None,
                    "cancel_flag_set_at": None,
                    "updated_at": datetime.now(UTC),
                }
            },
        )
        if result.modified_count:
            reverted.append(str(row["booking_id"]))
    if reverted:
        logger.warning(
            "Reverted %d abandoned cancel flag(s) from booking_id(s) %s",
            len(reverted),
            ", ".join(sorted(set(reverted))),
        )
    return len(reverted)


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
    the ``state`` prefix of the ``(state, updated_at)`` index narrows the scan to pending
    rows. ``created_at`` is only filtered, not indexed (the index's ``updated_at`` is not
    part of this filter), so the query is an index-assisted scan of the pending rows, not an
    index range lookup. Terminal rows
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


async def _ids_in_couch(
    couch: CouchClient, database: str, rows: list[ExternalBooking]
) -> set[str]:
    """Reserved household/evacuee ids of ``pending`` / ``cancelled`` / ``rejected`` rows in Couch.

    A previous attempt may have written some rows (``_bulk_docs`` is not atomic, and the
    process can die before the row transitions). The API may also have cancelled a row
    whose docs a crashed pass had already written, so ``cancelled`` rows are probed too,
    and so are ``rejected`` rows: one rejected as a per-person duplicate after its docs
    reached CouchDB (CR-169 D4) still proves the group reached it. A whole-group
    rejection never has docs, so probing those rows finds nothing. Only called on the
    (rare) paths where a duplicate shows up or a rejection must be finished.
    """
    ids = [
        value
        for row in rows
        if row.state in ("pending", "cancelled", "rejected")
        for value in (row.household_id, row.evacuee_id)
        if value
    ]
    if not ids:
        return set()
    found = await couch.find(
        database, {"_id": {"$in": ids}}, fields=["_id"], limit=len(ids)
    )
    return {doc["_id"] for doc in found if isinstance(doc, dict) and "_id" in doc}


async def _find_duplicates(
    couch: CouchClient, database: str, cids: list[str], own_ids: list[str]
) -> list[dict[str, Any]]:
    """Live evacuees (outside the group itself) holding any of ``cids`` (FR-21/FR-50).

    Returns the hits with ``person_id.number`` so the caller knows *which* CIDs collide.
    ``limit`` is the number of CIDs asked about; if the page comes back full, the CIDs
    already seen are dropped and the rest is asked again, so one CID with many holders
    cannot hide another collision.
    """
    hits: list[dict[str, Any]] = []
    remaining = list(dict.fromkeys(cids))
    while remaining:
        page = await couch.find(
            database,
            {
                "type": "evacuee",
                "person_id.number": {"$in": remaining},
                "current_stay.status": {"$in": list(HOLD_STATUSES)},
                # The group's own evacuees (a retry may already have written some).
                "_id": {"$nin": own_ids},
            },
            fields=["_id", "person_id.number"],
            limit=len(remaining),
        )
        hits.extend(page)
        seen = {number for number in map(_hit_cid, page) if number}
        if len(page) < len(remaining) or not seen:
            break
        remaining = [cid for cid in remaining if cid not in seen]
    return hits


def _hit_cid(doc: dict[str, Any]) -> str | None:
    return ((doc or {}).get("person_id") or {}).get("number")


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
    couch: CouchClient,
    database: str,
    booking: ExternalBooking,
    evacuee_id: str,
    *,
    strict: bool = False,
    now: str | None = None,
) -> str:
    """Cancel a ``pre_registered`` stay like the staff app does (FR-53).

    Stay → ``cancelled``, then an ``audit`` doc and the household roll-up. The stay is
    written with ``CouchClient.update_doc``: on a ``409`` (staff touched the evacuee in
    the meantime) the doc is re-read and the cancel is only applied if the stay is
    *still* ``pre_registered``, so a concurrent check-in is never overwritten.

    Returns ``_CANCELLED``; ``_CHANGED`` when the evacuee is missing or no longer
    ``pre_registered`` (nothing written — callers re-evaluate); ``_FAILED`` when the stay
    could not be written (caller retries).

    ``strict=False`` (EXT-009 cancel path): audit + household are best effort — the stay
    is the source of truth and the household status is derived from it (schema.md §1.3);
    a failure is logged (ids and exception type only) and ``_CANCELLED`` is still returned.
    ``strict=True`` (reconcile, #613): an audit or household write failure is raised after
    the stay was cancelled, so the row stays unreconciled; the next pass finishes it
    (`_ensure_stay_audit`, then the household step of `_reconcile_row`).

    ``now`` (default: the current time) is written as ``current_stay.since`` and, by the
    household roll-up, as the household's ``updated_at``; reconcile passes the value it
    stamped in the row's per-doc markers beforehand.
    """
    now = _now_iso() if now is None else now

    async def cancel(evacuee: dict[str, Any]) -> dict[str, Any] | None:
        if (evacuee.get("current_stay") or {}).get("status") != "pre_registered":
            return None
        return {
            **evacuee,
            "current_stay": {"status": "cancelled", "zone": None, "since": now},
            "updated_at": now,
        }

    try:
        cancelled = await couch.update_doc(database, evacuee_id, cancel)
    except Exception:
        logger.exception(
            "Could not cancel evacuee for booking %s",
            _ref(booking),
        )
        return _FAILED
    if cancelled is None:
        return _CHANGED

    try:
        await _write_audit_once(
            couch,
            database,
            _stay_audit(booking, evacuee_id, cancelled.get("household_id"), now),
        )
        if cancelled.get("household_id"):
            await _cancel_household_if_empty(
                couch,
                database,
                household_id=cancelled["household_id"],
                evacuee_id=evacuee_id,
                actor=partner_actor(booking.module_name, booking.client_id),
                now=now,
            )
    except Exception:
        if strict:
            raise
        logger.exception(
            "Cancel audit/household update failed for booking %s",
            _ref(booking),
        )
    return _CANCELLED


async def _cancel_stay_directly(
    couch: CouchClient, database: str, booking: ExternalBooking
) -> None:
    """Cancel the CouchDB stay of a row that must stay ``cancelled`` / ``rejected`` in Mongo.

    Used for a stranded ``cancelled`` row (`_cancel_stranded_rows`), a row the API
    cancelled while its docs were being written (`_mark_written`) and a row rejected as
    duplicate after its docs had reached CouchDB (`_reject_duplicated_rows`). Only a stay
    still ``pre_registered`` is touched; a failed write is logged (ids only) and not
    retried here. While a ``pending`` sibling is left the next pass retries it
    (`_cancel_stranded_rows`); with none left nothing would (the #595 residual).
    """
    if booking.evacuee_id:
        await _cancel_stay(couch, database, booking, booking.evacuee_id)


async def _mark_written(
    couch: CouchClient, booking: ExternalBooking, database: str
) -> None:
    """CAS one row `pending` → `written` + PII cleared, after its docs reached Couch."""
    if await _transition(booking, _PENDING, {"state": "written", **_PII_CLEARED}):
        logger.info(
            "Wrote booking %s to %s as %s", _ref(booking), database, booking.evacuee_id
        )
        return
    # The row moved under us. If the API cancelled it while we were writing (PII already
    # cleared, `cancel_reason` kept), the evacuee now exists in CouchDB and its stay must
    # be cancelled. The row stays `cancelled` — it is NOT re-opened as `written` +
    # `cancel_requested`: that left it stuck if staff checked the evacuee in before the
    # next poll (`not_cancellable`, still holding the CID) and needed a DuplicateKeyError
    # fallback when the partner had re-booked the CID. The cancel is applied right here.
    stored = await ExternalBooking.get_pymongo_collection().find_one(
        {"_id": booking.id}, {"state": 1}
    )
    if stored and stored.get("state") == "cancelled":
        logger.info(
            "Booking %s cancelled during write — cancelling stay %s directly",
            _ref(booking),
            booking.evacuee_id,
        )
        await _cancel_stay_directly(couch, database, booking)
    else:
        logger.warning(
            "Booking %s moved during write; evacuee %s written but row not updated",
            _ref(booking),
            booking.evacuee_id,
        )


async def _cancel_stranded_rows(
    couch: CouchClient, database: str, rows: list[ExternalBooking]
) -> None:
    """Cancel stays of ``cancelled`` / ``rejected`` rows whose evacuee reached CouchDB (R5).

    A crashed pass can leave docs in CouchDB for a row the API then cancelled
    (``pending`` → ``cancelled`` while the worker was down). Such a row is no longer
    ``pending``, so nothing else would ever cancel its stay. The same goes for a row
    rejected as duplicate (D4) whose stay cancel failed. A ``rejected`` row of a group
    that never reached CouchDB has no doc, so the call writes nothing. Only rows with
    reserved ids qualify, and only a stay still ``pre_registered`` is touched (a stay staff
    already checked in is left alone, FR-21 H8). The row keeps its terminal state
    (``cancelled`` / ``rejected``): the partner was told CANCELLED / REJECTED and the stay
    is cancelled right here (`_cancel_stay_directly`). Re-opening it as ``written`` +
    ``cancel_requested`` would leave it stuck there if staff checked the evacuee in
    before the next poll (the cancel then ends ``not_cancellable``) while it still held
    the CID. This runs when the group is processed again, i.e. while at least one
    sibling row is still ``pending``; if the API cancelled *all* rows the group is never
    due again (see module docstring).
    """
    for row in rows:
        if row.state not in ("cancelled", "rejected") or not row.evacuee_id:
            continue
        try:
            await _cancel_stay_directly(couch, database, row)
        except Exception:
            logger.exception(
                "Could not check stay of terminal booking %s",
                _ref(row),
            )


_DUP_CHECK_FAILED = (
    "Duplicate check failed for booking group %s (attempt %d, retry in %.0fs)"
)


def _group_key(booking_id: str) -> str:
    return f"group:{booking_id}"


async def _persist_group(
    couch: CouchClient, booking_id: str, *, health: FailureTracker | None = None
) -> bool:
    """Write a booking group's ``pending`` rows into ``shelter_{code}`` (FR-21, FR-34).

    False = retry next poll. The group is all-or-nothing up to the CouchDB write: one
    duplicate rejects every pending row — unless part of the group already reached
    CouchDB (crashed earlier attempt), then only the pending rows whose own CID is
    duplicated are rejected and the rest is written. Rows are written in one
    ``_bulk_docs`` and each row transitions on its own result. ``health`` (the loop's
    tracker) backs off and throttles logs for failures a retry may fix by itself: a
    failed CouchDB write, a missing shelter database, a failed duplicate check and a
    pending row without PII. An incomplete group is not backed off (usually a commit in
    flight).
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

    database = shelter_db_name(pending[0].shelter_code)
    if not await couch.database_exists(database):
        attempt, delay, log_it = _back_off(health, booking_id, "nodb")
        if log_it:
            logger.warning(
                "Shelter database %s missing for booking group %s (attempt %d, "
                "retry in %.0fs)",
                database,
                booking_id,
                attempt,
                delay,
            )
        return False

    # R1: an earlier pass rejected the group as duplicate but died before rejecting every
    # row. The duplicate check below would not see it again (the rejected rows' CIDs are
    # cleared) and would write the rest — finish the rejection instead (FR-21). Only when
    # nothing of the group reached CouchDB: otherwise the earlier rejection was a
    # per-person one (see below) and the remaining pending rows are still to be written.
    if any(
        row.state == "rejected" and row.reject_reason == "duplicate" for row in rows
    ):
        try:
            reached = any(row.state == "written" for row in rows) or bool(
                await _ids_in_couch(couch, database, rows)
            )
        except Exception:
            attempt, delay, log_it = _back_off(health, booking_id, "dupcheck")
            if log_it:
                logger.exception(_DUP_CHECK_FAILED, booking_id, attempt, delay)
            return False
        if not reached:
            rejected = await _reject_pending(booking_id)
            logger.info(
                "Finished rejecting booking group %s as duplicate (%d row(s))",
                booking_id,
                rejected,
            )
            return True

    if any(not row.cid or not row.first_name for row in pending):
        # PII is only cleared on a terminal transition — a pending row without it
        # cannot be written and would loop forever, so surface it loudly (throttled).
        attempt, delay, log_it = _back_off(health, booking_id, "nopii")
        if log_it:
            logger.error(
                "Booking group %s has a pending row with no PII — skipping "
                "(attempt %d, retry in %.0fs)",
                booking_id,
                attempt,
                delay,
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
        duplicates = await _find_duplicates(
            couch,
            database,
            [row.cid for row in pending],
            [row.evacuee_id for row in rows if row.evacuee_id],
        )
        in_couch = await _ids_in_couch(couch, database, rows) if duplicates else set()
    except Exception:
        attempt, delay, log_it = _back_off(health, booking_id, "dupcheck")
        if log_it:
            logger.exception(_DUP_CHECK_FAILED, booking_id, attempt, delay)
        return False

    if duplicates:
        reached = any(row.state == "written" for row in rows) or bool(in_couch)
        if not reached:
            rejected = await _reject_pending(booking_id)
            logger.info(
                "Rejected %d row(s) of booking group %s as duplicate in %s",
                rejected,
                booking_id,
                database,
            )
            return True
        # Part of the group is already in CouchDB (FR-21 retry rule): reject only the
        # persons whose own CID is now held by someone else; write the rest.
        pending = await _reject_duplicated_rows(
            couch, database, booking_id, pending, duplicates, in_couch
        )
        if not pending:
            await _cancel_stranded_rows(couch, database, rows)
            return True

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


def _back_off(
    health: FailureTracker, booking_id: str, kind: str
) -> tuple[int, float, bool]:
    """Back the group off; returns ``(attempt, retry delay, whether to log this time)``.

    ``kind`` names the failure so each one has its own log throttle; the backoff itself
    is per group. Only for failures a retry may fix on its own (CouchDB write failures,
    shelter DB not there yet, ...) — never for an incomplete group, which is usually just
    a commit in flight.
    """
    attempt, delay = health.failed(_group_key(booking_id))
    return attempt, delay, health.should_log(f"{kind}:{booking_id}")


def _write_failed(health: FailureTracker, booking_id: str) -> tuple[int, float, bool]:
    return _back_off(health, booking_id, "bulk")


async def _reject_duplicated_rows(
    couch: CouchClient,
    database: str,
    booking_id: str,
    pending: list[ExternalBooking],
    duplicates: list[dict[str, Any]],
    in_couch: set[str],
) -> list[ExternalBooking]:
    """Reject the pending rows whose own CID is a live duplicate; return the rest.

    FR-21 retry rule (CR-169 D1/D4): the group already reached CouchDB, so it is not
    rejected as a whole — only the persons whose own CID is now held by someone else are.
    That includes a row whose docs are already in CouchDB (crash after the bulk write):
    leaving its pre-registration live would give the CID two live holders (FR-50), so the
    row is rejected *and* its stay is cancelled (`_cancel_stay_directly`). Rows already
    ``written`` are not in ``pending`` and stay untouched.

    Order: the row is rejected first (a CAS on ``pending``; PII cleared), the stay cancelled
    second — whenever the row's docs are in CouchDB, whatever the CAS said. A row the API
    cancelled meanwhile fails the CAS and is dropped from the write; it is terminal either
    way (rejected by us or cancelled by the API) and, with no ``pending`` sibling left,
    nothing else would cancel its stay (`_cancel_stranded_rows` sees the stale in-memory
    state). The stay cancel is idempotent (only a still ``pre_registered`` stay is
    touched). If it fails it is logged (ids only); while a ``pending`` sibling is left the
    next pass retries it for the now-``rejected`` row (`_cancel_stranded_rows`), with none
    left nothing does — the #595 residual. Logs ids and counts only.
    """
    duplicated = {cid for cid in map(_hit_cid, duplicates) if cid}
    keep: list[ExternalBooking] = []
    rejected = 0
    for row in pending:
        if row.cid not in duplicated:
            keep.append(row)
            continue
        written_to_couch = row.evacuee_id in in_couch  # read before the PII is cleared
        if await _transition(
            row,
            _PENDING,
            {"state": "rejected", "reject_reason": "duplicate", **_PII_CLEARED},
        ):
            rejected += 1
        if written_to_couch:
            await _cancel_stay_directly(couch, database, row)
    logger.info(
        "Booking group %s partly written — rejected %d duplicated row(s), writing %d",
        booking_id,
        rejected,
        len(keep),
    )
    return keep


async def _cancel_household_if_empty(
    couch: CouchClient,
    database: str,
    *,
    household_id: str,
    evacuee_id: str | None,
    actor: str,
    now: str,
    exclude_evacuee: bool = True,
) -> bool:
    """Cancel the household once no member is still held (+ audit).

    The whole precondition (household still ``pre_registered``, no member in a
    ``_HOUSEHOLD_LIVE_STATUSES`` status; schema.md §1.3 derive rules 2-4 keep a household
    alive, CR-169 decision #613) runs inside ``update_doc``'s mutate, so after a ``409``
    (staff merged/moved members meanwhile) it is evaluated again on the fresh document.
    ``evacuee_id`` is excluded from the member check unless ``exclude_evacuee`` is False
    (reconcile of a stay that is past ``pre_registered``: that member counts like any
    other; #683). Returns True when this call cancelled the household. Raises on a
    CouchDB error.
    """

    async def cancel(household: dict[str, Any]) -> dict[str, Any] | None:
        if household.get("status") != "pre_registered":
            return None
        if await _household_still_held(
            couch, database, household_id, evacuee_id if exclude_evacuee else None
        ):
            return None
        return {**household, "status": "cancelled", "updated_at": now}

    cancelled = await couch.update_doc(database, household_id, cancel)
    if cancelled is None:
        return False
    await _write_audit_once(
        couch,
        database,
        _household_audit(
            household_id,
            cancelled.get("shelter_code") or "",
            evacuee_id,
            actor,
            now,
        ),
    )
    return True


async def _household_still_held(
    couch: CouchClient, database: str, household_id: str, evacuee_id: str | None
) -> bool:
    """True when a member other than ``evacuee_id`` is in a ``_HOUSEHOLD_LIVE_STATUSES`` stay."""
    members = await couch.find(
        database,
        {"type": "evacuee", "household_id": household_id},
        fields=["_id", "current_stay"],
        limit=200,
    )
    return any(
        m.get("_id") != evacuee_id
        and (m.get("current_stay") or {}).get("status") in _HOUSEHOLD_LIVE_STATUSES
        for m in members
    )


async def _process_cancel(couch: CouchClient, booking: ExternalBooking) -> bool:
    """Cancel a ``written`` booking's pre-registration (FR-53). False = retry next poll."""
    if booking.state != "written" or not booking.cancel_requested:
        return False
    if booking.cancel_flag_token is not None:
        # Still owned by an in-flight EXT-009 request: not due yet, and not a failure
        # (no backoff). `_find_due` already excludes these; this guards direct callers.
        return True
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

    if status == "pre_registered":
        outcome = await _cancel_stay(couch, database, booking, booking.evacuee_id)
        if outcome == _FAILED:
            return False
        if outcome == _CHANGED:
            # Staff moved the evacuee between our read and the write: leave the row due
            # and let the next poll re-read it (checked in -> not_cancellable, or already
            # cancelled -> finished).
            logger.info("Booking %s changed during cancel — re-checking", _ref(booking))
            return False

    # status == "cancelled" here means an earlier attempt (or staff) already cancelled
    # the stay — the booking outcome is the same, so finish it instead of refusing.
    await _transition(
        booking, _CANCEL_DUE, {"state": "cancelled", "cancel_requested": False}
    )
    logger.info("Cancelled booking %s in %s", _ref(booking), database)
    return True


#: Reconcile pass cadence (#613): it shares the sweeper's loop pass but runs at most once
#: per this interval.
RECONCILE_INTERVAL_SECONDS = 60.0
#: Terminal rows handled per reconcile pass (oldest first); the rest wait for the next one.
RECONCILE_BATCH_SIZE = 50

_RECONCILE_KEY_PREFIX = "reconcile:"
_RECONCILE_CANCELLED = "cancelled"
_RECONCILE_ADVANCED = "advanced"
_RECONCILE_MISSING = "missing"
_RECONCILE_NOOP = "noop"


class _ReconcileRetry(Exception):
    """A reconcile step could not finish this pass; the row stays unreconciled."""


def _stay_status(doc: dict[str, Any] | None) -> str | None:
    return ((doc or {}).get("current_stay") or {}).get("status")


def _cancelled_by_reconcile(stamp: str | None, marker: str | None) -> bool:
    """True when a cancelled doc carries the timestamp this row's reconcile wrote (#613 r3).

    CouchDB docs have no ``updated_by``, so the worker records the exact timestamp it
    writes on each doc as a per-doc marker; a mismatch (or no marker) means someone else,
    e.g. staff, cancelled it.
    """
    return marker is not None and stamp == marker


async def _ensure_stay_audit(
    couch: CouchClient,
    database: str,
    booking: ExternalBooking,
    evacuee: dict[str, Any],
) -> bool:
    """Audit retry for a stay the reconcile pass cancelled (#613). True = written now.

    Called only for a ``cancelled`` stay whose ``current_stay.since`` equals the row's
    ``reconcile_stay_cancelled_at``: its deterministic audit doc missing means the audit
    write failed after the cancel; it is written now (idempotent by id). A stay cancelled
    by someone else does not match the marker and never gets here.
    """
    return await _write_audit_once(
        couch,
        database,
        _stay_audit(
            booking, booking.evacuee_id or "", evacuee.get("household_id"), _now_iso()
        ),
    )


async def _ensure_household_audit(
    couch: CouchClient,
    database: str,
    booking: ExternalBooking,
    household: dict[str, Any],
) -> bool:
    """Audit retry for a household the reconcile pass cancelled (#613). True = written now.

    Called only for a ``cancelled`` household whose ``updated_at`` equals the row's
    ``reconcile_household_cancelled_at`` (see `_ensure_stay_audit`).
    """
    return await _write_audit_once(
        couch,
        database,
        _household_audit(
            booking.household_id or "",
            household.get("shelter_code") or "",
            booking.evacuee_id,
            partner_actor(booking.module_name, booking.client_id),
            _now_iso(),
        ),
    )


async def _mark_reconcile_cancel(
    booking: ExternalBooking, *, now: str, stay: bool, household: bool
) -> None:
    """Stamp the per-doc markers with ``now`` before the pass cancels a CouchDB doc (#613 r3).

    ``now`` is the exact timestamp the following write uses (``current_stay.since`` for the
    stay, ``updated_at`` for the household), so it is re-stamped on every attempt. The stamp
    is guarded on the state and ``reconciled_at`` observed by the pass; a moved row raises
    `_ReconcileRetry` so nothing is cancelled under a stale view. A Mongo error propagates
    and is retried as transient. A marker left behind by a write that did not happen is
    harmless: no later cancel by someone else carries the same timestamp.
    """
    changes: dict[str, Any] = {}
    if stay:
        changes["reconcile_stay_cancelled_at"] = now
    if household:
        changes["reconcile_household_cancelled_at"] = now
    stamped = await _transition(
        booking, {"state": booking.state, "reconciled_at": None}, changes
    )
    if not stamped:
        raise _ReconcileRetry("row moved before the cancel")


async def _reconcile_row(couch: CouchClient, booking: ExternalBooking) -> str:
    """Finish one terminal row against the docs it reserved in ``shelter_{code}`` (#613).

    Reads the reserved ``evacuee_id`` / ``household_id`` directly (no Mango for the docs):

    * neither doc exists (an absent shelter database also answers 404) → ``missing``;
    * the stay moved past ``pre_registered`` → ``advanced``; the stay is left alone and
      the household is still evaluated below (#683);
    * a ``pre_registered`` stay → one timestamp ``now`` is stamped on the row as
      ``reconcile_stay_cancelled_at`` (and ``reconcile_household_cancelled_at`` when the
      row reserved a household, since the roll-up writes the same ``now``), then the stay
      is cancelled through ``_cancel_stay(strict=True, now=now)``; a failed or changed
      write, or a failed audit / household write after the cancel, raises so the row is
      retried (``reconciled_at`` stays unset);
    * a ``cancelled`` stay with its audit doc missing is audited only when its
      ``current_stay.since`` equals ``reconcile_stay_cancelled_at`` (an earlier pass
      cancelled it and its audit write failed); any other stamp means someone else (e.g.
      staff) cancelled it → no partner audit;
    * the household is re-read: still ``pre_registered`` → a fresh ``now`` is stamped as
      ``reconcile_household_cancelled_at`` first, then it is cancelled by
      ``_cancel_household_if_empty`` with that ``now`` (only once no member is still held,
      i.e. none in pre_registered / kiosk_registered / arriving / active / room_confirmed /
      temporary_leave; checked_out, transferred, deceased and cancelled members do not
      hold it; when the stay itself is past ``pre_registered`` it counts as a member;
      covers a household left behind by a failed roll-up and household-only rows); already ``cancelled`` → its audit is written only when its ``updated_at``
      equals ``reconcile_household_cancelled_at``, as for the stay;
    * anything cancelled or audited in this pass → ``cancelled``; otherwise ``advanced``
      when the stay was past ``pre_registered`` (household kept, or already cancelled by
      someone else), else ``noop``.

    Raises on a CouchDB error (the caller leaves the row unreconciled). Logs ids only.
    """
    database = shelter_db_name(booking.shelter_code)
    evacuee = (
        await couch.get_doc(database, booking.evacuee_id)
        if booking.evacuee_id
        else None
    )
    household = (
        await couch.get_doc(database, booking.household_id)
        if booking.household_id
        else None
    )
    if evacuee is None and household is None:
        return _RECONCILE_MISSING

    status = _stay_status(evacuee)
    advanced = status not in (None, "pre_registered", "cancelled")
    if advanced:
        logger.warning(
            "Booking %s: stay is past pre_registered — left untouched", _ref(booking)
        )

    cancelled = False
    if advanced:
        pass
    elif status == "pre_registered":
        now = _now_iso()
        await _mark_reconcile_cancel(
            booking, now=now, stay=True, household=booking.household_id is not None
        )
        outcome = await _cancel_stay(
            couch, database, booking, booking.evacuee_id, strict=True, now=now
        )
        if outcome != _CANCELLED:
            raise _ReconcileRetry(outcome)
        cancelled = True
    elif (
        status == "cancelled"
        and evacuee is not None
        and _cancelled_by_reconcile(
            (evacuee.get("current_stay") or {}).get("since"),
            booking.reconcile_stay_cancelled_at,
        )
    ):
        cancelled = await _ensure_stay_audit(couch, database, booking, evacuee)

    if booking.household_id:
        fresh = await couch.get_doc(database, booking.household_id)
        if fresh is not None and fresh.get("status") == "pre_registered":
            now_household = _now_iso()
            await _mark_reconcile_cancel(
                booking, now=now_household, stay=False, household=True
            )
            cancelled |= await _cancel_household_if_empty(
                couch,
                database,
                household_id=booking.household_id,
                evacuee_id=booking.evacuee_id,
                actor=partner_actor(booking.module_name, booking.client_id),
                now=now_household,
                exclude_evacuee=not advanced,
            )
        elif (
            fresh is not None
            and fresh.get("status") == "cancelled"
            and _cancelled_by_reconcile(
                fresh.get("updated_at"), booking.reconcile_household_cancelled_at
            )
        ):
            cancelled |= await _ensure_household_audit(couch, database, booking, fresh)

    if cancelled:
        return _RECONCILE_CANCELLED
    return _RECONCILE_ADVANCED if advanced else _RECONCILE_NOOP


def _reconcile_key(booking_id: str) -> str:
    return f"{_RECONCILE_KEY_PREFIX}{booking_id}"


async def _reconcile_booking(
    couch: CouchClient, booking: ExternalBooking, health: FailureTracker
) -> bool:
    """Reconcile one row and stamp ``reconciled_at`` / ``reconcile_outcome``.

    False = left unreconciled for the next pass (a CouchDB error, a stay changed during
    the pass, or the row moved under the guarded write). The stamp is guarded on the
    row's state and ``reconciled_at`` still unset, so a row is never stamped twice.

    A failed row is recorded in ``health`` only so that ``reconcile_terminal_bookings``
    can take it after the healthy rows; it is retried on the next pass, not held back by a
    timer (decision #613: a transient error is retried in the next reconcile cycle).
    """
    key = _reconcile_key(booking.id)
    try:
        outcome = await _reconcile_row(couch, booking)
    except _ReconcileRetry as exc:
        if health.should_log(key):
            logger.info(
                "Reconcile of booking %s deferred (%s) — retry next pass",
                _ref(booking),
                exc,
            )
        health.failed(key)
        return False
    except Exception:
        # logger.exception: the _ExceptionTypeOnly filter logs the type and location only.
        if health.should_log(key):
            logger.exception(
                "Reconcile of booking %s failed — retry next pass", _ref(booking)
            )
        health.failed(key)
        return False
    health.succeeded(key)

    stamped = await _transition(
        booking,
        {"state": booking.state, "reconciled_at": None},
        {"reconciled_at": datetime.now(UTC), "reconcile_outcome": outcome},
    )
    if not stamped:
        logger.info(
            "Booking %s moved during reconcile — retry next pass", _ref(booking)
        )
    return stamped


async def reconcile_terminal_bookings(
    couch: CouchClient, health: FailureTracker | None = None
) -> int:
    """Reconcile up to ``RECONCILE_BATCH_SIZE`` unreconciled terminal rows (#613).

    Selects ``cancelled`` / ``rejected`` rows that reserved a ``evacuee_id`` or
    ``household_id`` and have no ``reconciled_at`` (legacy rows without the field match
    too: Mongo ``null`` matches a missing key). Returns the number of rows stamped.

    Rows that have not failed in an earlier pass come first (oldest first). Rows that
    failed earlier are retried on every pass but only fill the slots left over, so a set
    of rows that fail every time cannot push newer healthy rows out of the batch. ``health``
    holds only those failure marks and the log throttle; no retry timer applies.
    """
    health = FailureTracker() if health is None else health
    base: dict[str, Any] = {
        "state": {"$in": ["cancelled", "rejected"]},
        "reconciled_at": None,
        "$or": [
            {"evacuee_id": {"$ne": None}},
            {"household_id": {"$ne": None}},
        ],
    }
    failing_ids = [
        key[len(_RECONCILE_KEY_PREFIX) :] for key in health.keys(_RECONCILE_KEY_PREFIX)
    ]

    rows = (
        await ExternalBooking.find({**base, "_id": {"$nin": failing_ids}})
        .sort("updated_at", "_id")
        .limit(RECONCILE_BATCH_SIZE)
        .to_list()
    )
    if len(rows) < RECONCILE_BATCH_SIZE and failing_ids:
        rows += (
            await ExternalBooking.find({**base, "_id": {"$in": failing_ids}})
            .sort("updated_at", "_id")
            .limit(RECONCILE_BATCH_SIZE - len(rows))
            .to_list()
        )
    stamped = 0
    for booking in rows:
        if await _reconcile_booking(couch, booking, health):
            stamped += 1
    return stamped


async def _find_due() -> list[ExternalBooking]:
    """Rows to act on; `committed=False` rows are still being staged by the API (FR-32)."""
    return await ExternalBooking.find(
        {
            "committed": {"$ne": False},
            "$or": [
                {"state": "pending"},
                _CANCEL_DUE,
            ],
        }
    ).to_list()


def _record_failure(health: FailureTracker, key: str) -> None:
    """``health.failed`` that can never raise out of the poll (one key must not kill it)."""
    try:
        health.failed(key)
    except Exception:
        logger.exception("Could not record failure for %s", key)


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
            _record_failure(health, key)
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
            _record_failure(health, key)


async def run_external_booking_inbound_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    health = FailureTracker()
    reconcile_health = FailureTracker()
    last_reconcile: float | None = None
    while not stop_event.is_set():
        # Own try/except: a sweeper failure must not stop bookings being written.
        try:
            await sweep_stale_staged()
        except Exception:
            logger.exception("Staged external booking sweep failed")
        # Reconcile terminal rows in the same pass, at most once per interval (#613).
        # Own try/except for the same reason; the timer is set first so a failing pass is
        # not retried on every 3 s poll.
        if (
            last_reconcile is None
            or _clock() - last_reconcile >= RECONCILE_INTERVAL_SECONDS
        ):
            last_reconcile = _clock()
            try:
                await reconcile_terminal_bookings(couch, reconcile_health)
            except Exception:
                logger.exception("Terminal booking reconcile pass failed")
        try:
            await revert_abandoned_cancel_flags()
        except Exception:
            logger.exception("Abandoned cancel flag revert failed")
        try:
            due = await _find_due()
        except Exception:
            logger.exception("Inbound external booking poll failed")
        else:
            # Last line of defence: no single key or row may kill the inbound task —
            # a dead task means accepted bookings are never written and PII lingers.
            try:
                await _run_poll(couch, due, health, stop_event)
            except Exception:
                if health.should_log("error:poll-pass"):
                    logger.exception("Inbound external booking poll pass failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
