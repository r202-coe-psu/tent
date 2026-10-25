"""Use case for EXT-008–010 partner bookings (M2, CR-154 C3/C4 FR-10..20, FR-30..36).

CR-169: one request may carry up to `MAX_PERSONS` people. Each person is its own
`external_bookings` row; rows of one request share a `booking_id` (the group key) and are
inserted all-or-nothing (staged with `committed=False`, no Mongo transaction).

FastAPI never touches CouchDB: an accepted booking is a row in `external_bookings`
(schema.md §9.7) that the sync worker writes into `shelter_{code}` asynchronously.

The scope is checked here (not on the router) so denied attempts are still logged, and
every attempt lands in `third_party_access_logs` — never with the CID, phone or names.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from pymongo.errors import BulkWriteError, DuplicateKeyError
from tent_model.external_booking import OPEN_BOOKING_STATES, ExternalBooking
from tent_model.external_booking_idempotency import ExternalBookingIdempotency
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from ...utils.masking import national_id_hash, normalize_phone
from ...utils.shelter_booking import accepts_booking
from ...utils.thai_id import is_valid_thai_national_id
from ...utils.ulid import new_ulid
from ..thirdparty_auth.scopes import ThirdPartyClaims
from .schemas import (
    MAX_PERSONS,
    BookingCancelledEnvelope,
    BookingCancelledResult,
    BookingCancelRequest,
    BookingCreatedEnvelope,
    BookingCreatedResult,
    BookingCreateRequest,
    BookingPersonInput,
    BookingPersonStatus,
    BookingStatus,
    BookingStatusEnvelope,
    BookingStatusResult,
)

ENDPOINT_CREATE = "EXT-008"
ENDPOINT_CANCEL = "EXT-009"
ENDPOINT_STATUS = "EXT-010"
_REQUIRED_SCOPE = "booking-write"
# #751 - EOC override: rides on `booking-write`, skips every acceptance condition (incl. closed).
_BYPASS_SCOPE = "booking-bypass"
_BANGKOK_TZ = ZoneInfo("Asia/Bangkok")
_PHONE_RE = re.compile(r"^0\d{8,9}$")
_CID_RE = re.compile(r"^[0-9]{13}$")
_MAX_CANCEL_REASON = 200
_MAX_IDEMPOTENCY_KEY = 255
# #614 (decision sync 2026-10-17): an `in_progress` key older than this is judged from the
# real rows of its booking_id instead of answering 409 forever.
_IN_PROGRESS_STALE_SECONDS = 60

# Stay statuses that hold a place at a shelter (FR-17a). Keep in sync with the
# registration gate in `frontend/src/lib/features/public-register/domain/booking-gate.ts`.
HOLD_STATUSES: tuple[str, ...] = (
    "pre_registered",
    "arriving",
    "active",
    "room_confirmed",
    "temporary_leave",
)


_DUPLICATE_KEY_CODE = 11000
_COMMIT_ATTEMPTS = 3
_CLEANUP_ATTEMPTS = 3
_CANCEL_ROW_ATTEMPTS = 3
_RETRY_BACKOFF_SECONDS = 0.05  # multiplied by the attempt number
# CR-169 FR-40: how long a request waits on another request's in-flight cancel flag.
_FLAG_WAIT_SECONDS = 1.0
_FLAG_POLL_SECONDS = 0.1

# Messages here must never carry a CID, phone, name or document body: only the booking_id
# and the exception *type* are logged.
logger = logging.getLogger(__name__)

# Strong references so a detached task is not garbage-collected mid-flight.
_detached_tasks: set[asyncio.Task[Any]] = set()


def _detach(work: Awaitable[Any]) -> asyncio.Task[Any]:
    """Run `work` as its own task that cancelling the caller cannot cancel."""
    task = asyncio.ensure_future(work)
    _detached_tasks.add(task)
    task.add_done_callback(_detached_tasks.discard)
    return task


async def _with_retry(
    operation: Callable[[], Awaitable[Any]],
    *,
    what: str,
    booking_id: str,
    attempts: int,
    reraise: bool,
    give_up: str,
    fatal: tuple[type[Exception], ...] = (),
) -> None:
    """Run `operation` up to `attempts` times, logging only the booking_id and error type.

    After the last failed attempt the exception is re-raised (`reraise=True`) or swallowed
    after logging `give_up` as an error, so a caller's original exception is not masked.
    An exception in `fatal` is not transient: it is logged and re-raised at once.
    """
    for attempt in range(1, attempts + 1):
        try:
            await operation()
            return
        except Exception as exc:
            logger.warning(
                "%s failed (booking_id=%s attempt=%d error=%s)",
                what,
                booking_id,
                attempt,
                type(exc).__name__,
            )
            if isinstance(exc, fatal):
                raise
            if attempt == attempts:
                if reraise:
                    raise
                logger.error("%s (booking_id=%s attempts=%d)", give_up, booking_id, attempts)
                return
            await asyncio.sleep(_RETRY_BACKOFF_SECONDS * attempt)


async def _cleanup_staged(
    collection: Any, flt: dict[str, Any], *, after: asyncio.Task[Any] | None = None
) -> None:
    """Delete staged rows matching `flt`, shielded from cancellation and retried.

    `after` is an in-flight insert: the delete only starts once it has settled, so a
    cancelled request cannot delete before mongod finished applying the insert.
    Never raises on a delete failure (it is logged), so the caller's original exception
    keeps propagating instead of being masked by the cleanup error.
    """

    async def cleanup() -> None:
        if after is not None:
            await asyncio.wait({after})
            if not after.cancelled():
                after.exception()  # mark retrieved; its text may embed the rows
        await _with_retry(
            lambda: collection.delete_many(flt),
            what="staged booking cleanup",
            booking_id=str(flt.get("booking_id")),
            attempts=_CLEANUP_ATTEMPTS,
            reraise=False,
            give_up="staged booking rows could not be removed",
        )

    await asyncio.shield(_detach(cleanup()))


class CommitShortfallError(RuntimeError):
    """The commit flip matched fewer rows than the group has (the worker swept some)."""


async def _commit_group(collection: Any, booking_id: str, group_size: int) -> None:
    """Flip a staged group to `committed=True`; retried since the flip is idempotent.

    `matched_count` must equal `group_size`. A shortfall means the worker's sweeper
    (FR-33: it deletes `committed=False` rows older than its TTL, then the group's remaining
    `pending` rows) removed rows while this request was still committing, e.g. a stalled
    API or clock skew between the worker's cutoff and `created_at`. Telling the partner
    "201" for rows that no longer exist would be a lie, so a shortfall fails the commit
    (no retry: the rows are gone for good) and the caller's cleanup + 500 path runs.
    """

    async def flip() -> None:
        result = await collection.update_many(
            {"booking_id": booking_id}, {"$set": {"committed": True}}
        )
        if result.matched_count != group_size:
            raise CommitShortfallError(
                f"matched {result.matched_count} of {group_size} staged rows"
            )

    await _with_retry(
        flip,
        what="booking commit",
        booking_id=booking_id,
        attempts=_COMMIT_ATTEMPTS,
        reraise=True,
        give_up="booking commit gave up",
        fatal=(CommitShortfallError,),
    )


def _error(status_code: int, code: str, message: str, detail: str | None = None) -> HTTPException:
    error = {"code": code, "message": message}
    if detail is not None:
        error["detail"] = detail
    return HTTPException(status_code=status_code, detail={"error": error})


def _to_bangkok_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(_BANGKOK_TZ).isoformat()


def _booking_status(booking: ExternalBooking) -> BookingStatus:
    """FR-35 — `cancel_requested` already reads as CANCELLED to the partner."""
    if booking.state == "cancelled" or booking.cancel_requested:
        return "CANCELLED"
    if booking.state == "rejected":
        return "REJECTED"
    return "BOOKED"


def _clean(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


@dataclass(frozen=True)
class _Person:
    cid: str
    first_name: str
    last_name: str
    phone: str


def _validate_person(raw: BookingPersonInput, prefix: str) -> tuple[_Person, list[str], list[str]]:
    """Clean one person; returns (person, missing field refs, format problems).

    `prefix` is `persons[i].` for the array shape and empty for the legacy single shape.
    Messages name fields only — never the submitted values.
    """
    person = _Person(
        cid=_clean(raw.cid),
        first_name=_clean(raw.first_name),
        last_name=_clean(raw.last_name),
        phone=normalize_phone(_clean(raw.phone)),
    )
    missing = [
        f"{prefix}{name}"
        for name in ("cid", "first_name", "last_name", "phone")
        if not getattr(person, name)
    ]
    problems: list[str] = []
    if person.cid and (not _CID_RE.match(person.cid) or not is_valid_thai_national_id(person.cid)):
        problems.append(f"{prefix}cid must be 13 digits with a valid checksum.")
    if person.phone and not _PHONE_RE.match(person.phone):
        problems.append(f"{prefix}phone must be a 9–10 digit Thai number.")
    return person, missing, problems


def _stay_allows_cancel(stay: str | None) -> bool:
    """FR-32 — a missing projection (`None`) means the worker's write has not synced yet,
    so the stay is still `pre_registered`; any other stay status has checked in or moved on.
    """
    return stay is None or stay == "pre_registered"


def _classify_cancel(
    row: ExternalBooking, person_status: dict[str, str]
) -> Literal["direct", "request"] | None:
    """FR-31/32/33 for one row: cancel outright, ask the worker to, or not cancellable."""
    if row.state == "pending":
        return "direct"
    if row.state == "written" and not row.cancel_requested:
        stay = person_status.get(row.evacuee_id) if row.evacuee_id else None
        if _stay_allows_cancel(stay):
            return "request"
    return None


def _to_milliseconds(value: datetime) -> datetime:
    """Mongo stores datetimes at millisecond precision; the cancel marker must round-trip."""
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def _foreign_flag(row: ExternalBooking, token: str) -> bool:
    """A written row flagged for cancel by another request whose cancel is still in flight.

    CR-169 FR-40 (decision sync 2026-10-17): a flag carries the `cancel_flag_token` of the request
    that set it and that request clears the token when it is over. A flag with a token other than
    `token` is in flight and is waited on (`_await_foreign_flag`). A flag without a token is
    FINISHED: a legacy flag, or a flag whose request has finished.
    """
    return (
        row.state == "written"
        and bool(row.cancel_requested)
        and row.cancel_flag_token is not None
        and row.cancel_flag_token != token
    )


def _is_open(row: ExternalBooking) -> bool:
    """CR-169 FR-40 — an OPEN row is `pending`, or `written` with cancel not yet requested.

    Every other row (`cancelled`, `rejected`, `written` with `cancel_requested`) is FINISHED.
    """
    return row.state in OPEN_BOOKING_STATES and not row.cancel_requested


def _is_complete_group(rows: list[ExternalBooking]) -> bool:
    """True when `rows` are exactly persons 0..group_size-1 of one group.

    A commit flip (`update_many`) is not atomic, so mid-flip a reader can see only some of
    a group's rows as committed. Rows written before CR-169 default to a group of one.
    """
    sizes = {row.group_size for row in rows}
    if len(sizes) != 1:
        return False
    size = sizes.pop()
    return len(rows) == size and [row.person_seq for row in rows] == list(range(size))


def _request_hash(location_code: str, persons: list[_Person]) -> str:
    """sha256 of the canonical, normalized create request (EXT-008 Idempotency-Key, #614).

    Each CID is replaced by its `national_id_hash` before hashing, so the raw CID is never
    fed into the digest; names and phone are hashed but never stored.
    """
    canonical = {
        "location_code": location_code,
        "persons": [
            {
                "cid": national_id_hash(person.cid),
                "first_name": person.first_name,
                "last_name": person.last_name,
                "phone": person.phone,
            }
            for person in persons
        ],
    }
    payload = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _aware(value: datetime) -> datetime:
    """Stored datetimes read back naive (UTC); treat them as UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _created_envelope(
    booking_id: str, location_code: str, persons_count: int
) -> BookingCreatedEnvelope:
    return BookingCreatedEnvelope(
        result=BookingCreatedResult(
            booking_id=booking_id, location_code=location_code, persons_count=persons_count
        )
    )


async def _committed_count(collection: Any, booking_id: str) -> int | None:
    """Number of committed rows of `booking_id`; None when the count cannot be read."""
    try:
        return await collection.count_documents({"booking_id": booking_id, "committed": True})
    except Exception as exc:
        logger.warning(
            "commit check failed (booking_id=%s error=%s)", booking_id, type(exc).__name__
        )
        return None


async def _staged_count(collection: Any, booking_id: str) -> int | None:
    """Number of staged (`committed: false`) rows of `booking_id`; None when unreadable."""
    try:
        return await collection.count_documents({"booking_id": booking_id, "committed": False})
    except Exception as exc:
        logger.warning(
            "staged count failed (booking_id=%s error=%s)", booking_id, type(exc).__name__
        )
        return None


async def _all_rows_committed(collection: Any, booking_id: str, group_size: int) -> bool | None:
    """G5 — True when every row of the group is committed although the flip raised.

    The flip may have been applied and only its acknowledgement lost. None when the count
    cannot be read: the caller must not treat the group as removable without owning the key.
    """
    committed = await _committed_count(collection, booking_id)
    return None if committed is None else committed == group_size


def _lease_filter(record_id: str, created_at: datetime) -> dict[str, Any]:
    """#614 — the key row as long as it is still this attempt's own `in_progress` lease.

    `created_at` is the lease: a stale-key claim renews it, so a write guarded by the old value
    matches nothing once the key was taken over (or completed, or released by its new owner).
    """
    return {"_id": record_id, "status": "in_progress", "created_at": created_at}


async def _release_key(record_id: str | None, created_at: datetime, booking_id: str) -> bool:
    """Delete the Idempotency-Key row of a request that created no booking (#614).

    Guarded by this attempt's lease (`_lease_filter`): a key that was taken over by a later
    retry, or completed, is never deleted. Returns True when the row is gone (this delete, an
    earlier attempt whose ack was lost, or a claim that freed it), False when it is still held
    by someone else or the delete gave up. Shielded and retried like the staged-row cleanup;
    a give-up is logged, never raised.
    """
    if record_id is None:
        return True
    collection = ExternalBookingIdempotency.get_pymongo_collection()

    async def release() -> bool:
        try:
            await _with_retry(
                lambda: collection.delete_one(_lease_filter(record_id, created_at)),
                what="idempotency key release",
                booking_id=booking_id,
                attempts=_CLEANUP_ATTEMPTS,
                reraise=True,
                give_up="idempotency key could not be released",
            )
            gone = await collection.count_documents({"_id": record_id}) == 0
        except Exception:
            logger.error(
                "idempotency key could not be released (booking_id=%s attempts=%d)",
                booking_id,
                _CLEANUP_ATTEMPTS,
            )
            return False
        if not gone:
            logger.warning("idempotency key lease lost, not released (booking_id=%s)", booking_id)
        return gone

    return await asyncio.shield(_detach(release()))


async def _drop_rows(collection: Any, booking_id: str, extra: dict[str, Any]) -> bool:
    """Delete the rows of `booking_id` matching `extra`, retried; True when the delete ran (#614).

    Unlike `_cleanup_staged` this reports failure, because the takeover decides from the
    rows that remain. Only the booking_id is logged.
    """
    try:
        await _with_retry(
            lambda: collection.delete_many({"booking_id": booking_id, **extra}),
            what="stale group cleanup",
            booking_id=booking_id,
            attempts=_CLEANUP_ATTEMPTS,
            reraise=True,
            give_up="stale group cleanup gave up",
        )
    except Exception:
        return False
    return True


async def _claim_stale_key(
    record: ExternalBookingIdempotency, persons_count: int
) -> Literal["completed", "free", "busy"]:
    """Claim a stale `in_progress` key whose group has no committed row, or is partly committed
    with no staged row left (#614).

    1. Lease: `created_at` of the key row is set to now, guarded by its old value. Only one
       racing request matches; the others see a young row, and the stalled attempt's fence
       (which checks `created_at`) now fails. The row keeps its `_id` and `booking_id`.
    2. Remove the staged (`committed: false`) rows of `booking_id`. This must succeed before the
       count, because a stalled flip can only touch rows that are still staged.
    3. Recount the committed rows. All committed → the booking stands: the key is completed
       (`completed`). None → the row is deleted with its lease value (`free`), so the caller
       proceeds as a new request. Some (a flip raced the lease) → the rest of the group is
       removed, as the sweeper's phase 2 does, so no committed PII outlives the decision; the
       key stays `in_progress` and answers 409 (`busy`). If that removal gives up, the group is
       left partly committed with no staged row, which the sweeper never reaches; the caller
       claims such a group again on the next stale retry, so the removal is retried.
    Any failure before step 3 answers `busy`; the key keeps its new age, so the partner retries.
    Shielded and detached, so a cancelled request cannot split the decision.
    """
    key_collection = ExternalBookingIdempotency.get_pymongo_collection()
    collection = ExternalBooking.get_pymongo_collection()
    claimed_at = datetime.now(UTC)

    async def claim() -> Literal["completed", "free", "busy"]:
        try:
            leased = await key_collection.update_one(
                {"_id": record.id, "status": "in_progress", "created_at": record.created_at},
                {"$set": {"created_at": claimed_at}},
            )
        except Exception as exc:
            logger.warning(
                "idempotency key takeover failed (booking_id=%s error=%s)",
                record.booking_id,
                type(exc).__name__,
            )
            return "busy"
        if leased.matched_count != 1:
            return "busy"
        if not await _drop_rows(collection, record.booking_id, {"committed": False}):
            return "busy"
        committed = await _committed_count(collection, record.booking_id)
        if committed is None:
            return "busy"
        if committed == persons_count:
            await _complete_key(record.id, claimed_at, record.booking_id)
            return "completed"
        if committed > 0:
            if not await _drop_rows(collection, record.booking_id, {"state": "pending"}):
                # The key keeps its new lease; once it is stale again the next retry finds a
                # partial group with no staged row and claims it again (`_resolve_in_progress`).
                logger.error(
                    "partial group could not be removed, a later retry tries again (booking_id=%s)",
                    record.booking_id,
                )
            return "busy"
        try:
            deleted = await key_collection.delete_one(
                {"_id": record.id, "status": "in_progress", "created_at": claimed_at}
            )
        except Exception as exc:
            logger.warning(
                "idempotency key release failed (booking_id=%s error=%s)",
                record.booking_id,
                type(exc).__name__,
            )
            return "busy"
        return "free" if deleted.deleted_count == 1 else "busy"

    return await asyncio.shield(_detach(claim()))


async def _complete_key(record_id: str | None, created_at: datetime, booking_id: str) -> None:
    """Mark the Idempotency-Key row `completed` once the group is committed (#614).

    Guarded by this attempt's lease (`_lease_filter`). A lost lease matches nothing and that is
    fine: whoever holds the key now judges the same fully committed rows and completes it (or
    the next stale retry does). The booking exists at this point, so this never releases the
    row; a give-up is logged.
    """
    if record_id is None:
        return
    collection = ExternalBookingIdempotency.get_pymongo_collection()

    async def complete() -> None:
        await collection.update_one(
            _lease_filter(record_id, created_at), {"$set": {"status": "completed"}}
        )

    await asyncio.shield(
        _detach(
            _with_retry(
                complete,
                what="idempotency key completion",
                booking_id=booking_id,
                attempts=_COMMIT_ATTEMPTS,
                reraise=False,
                give_up="idempotency key could not be marked completed",
            )
        )
    )


async def _still_owns_key(record_id: str | None, created_at: datetime) -> bool:
    """#614 fence — True while this request's `in_progress` key row is still its own.

    A stale key can be claimed by a later retry (`_claim_stale_key`), which renews `created_at`
    and may remove the staged rows of this attempt. Checked after the insert and before the
    commit flip, so an attempt that stalled past the claim never commits a booking it no longer
    owns. A read failure counts as not owned (the partner retries; nothing is committed).
    Shielded and detached, so a cancel cannot split the check from the caller's cleanup.
    """
    if record_id is None:
        return True
    collection = ExternalBookingIdempotency.get_pymongo_collection()

    async def check() -> bool:
        try:
            return await collection.count_documents(_lease_filter(record_id, created_at)) == 1
        except Exception as exc:
            logger.warning("idempotency key ownership check failed (error=%s)", type(exc).__name__)
            return False

    return await asyncio.shield(_detach(check()))


async def _settle_unconfirmed_commit(
    collection: Any,
    *,
    booking_id: str,
    group_size: int,
    record_id: str | None,
    created_at: datetime,
) -> bool:
    """Keep the group (G5) or remove it after a flip whose outcome is unknown (#614).

    True when every row is committed: the key is completed (lease-guarded) and the rows are kept
    for the worker. Otherwise the group is removed and the key released, both only as far as
    this attempt still owns them:
    - count read → it is below `group_size`, and since this attempt's flip has finished it can
      only fall, so nobody else can see this group as booked: remove every row of the
      booking_id still `pending` (the flip may have touched only some, so `committed` no longer
      tells them apart; rows the worker advanced cannot be rolled back), then release the key
      guarded by the lease. If the removal gives up, the key is kept `in_progress`: the
      same-key retry judges it stale after 60 s and removes the group then.
    - count unreadable → the group may be fully committed and a retry that took the key over
      may already have answered 201 for it. Release the key first (lease-guarded); only if the
      row is gone does nobody else own this booking_id, and the pending rows are removed.
      Without an Idempotency-Key there is no one else, so the rows are removed as before.
    """
    committed = await _all_rows_committed(collection, booking_id, group_size)
    if committed:
        logger.warning("commit unconfirmed but every row is committed (booking_id=%s)", booking_id)
        await _complete_key(record_id, created_at, booking_id)
        return True
    pending = {"booking_id": booking_id, "state": "pending"}
    if committed is None and record_id is not None:
        if await _release_key(record_id, created_at, booking_id):
            await _cleanup_staged(collection, pending)
        return False
    if not await _drop_rows(collection, booking_id, {"state": "pending"}):
        # Rows may be left partly committed. The key is kept `in_progress` so the same-key
        # retry, once it is stale, removes the group (`_resolve_in_progress`); a released key
        # would leave the rows blocking these CIDs with `duplicate_booking` instead.
        logger.error(
            "failed group could not be removed, key not released (booking_id=%s)",
            booking_id,
        )
        return False
    await _release_key(record_id, created_at, booking_id)
    return False


async def _settle_cancelled_commit(
    collection: Any,
    commit_task: asyncio.Task[Any],
    *,
    booking_id: str,
    group_size: int,
    record_id: str | None,
    created_at: datetime,
) -> None:
    """Settle a commit whose request was cancelled, then keep the group or release it (#614).

    The flip task is awaited before anything is counted, because `update_many` may still be
    applied after the cancel; then `_settle_unconfirmed_commit` decides. Shielded and detached,
    so a second cancel cannot interrupt the decision.
    """

    async def settle() -> None:
        await asyncio.wait({commit_task})
        if not commit_task.cancelled():
            commit_task.exception()  # mark retrieved; a failed flip is handled here, not raised
        await _settle_unconfirmed_commit(
            collection,
            booking_id=booking_id,
            group_size=group_size,
            record_id=record_id,
            created_at=created_at,
        )

    await asyncio.shield(_detach(settle()))


async def _settle_failed_commit(
    collection: Any,
    *,
    booking_id: str,
    group_size: int,
    record_id: str | None,
    created_at: datetime,
) -> bool:
    """Settle a commit whose flip raised: keep the group (G5) or remove it (#614).

    Returns True when every row is committed (the flip was applied, only its acknowledgement
    was lost). See `_settle_unconfirmed_commit`. Runs detached and shielded by the caller, so
    the count and the cleanup finish even when the request is cancelled.
    """
    return await _settle_unconfirmed_commit(
        collection,
        booking_id=booking_id,
        group_size=group_size,
        record_id=record_id,
        created_at=created_at,
    )


class ThirdPartyBookingsUseCase:
    async def _log(
        self,
        *,
        endpoint: str,
        claims: ThirdPartyClaims,
        client_ip: str,
        outcome: str,
        location_code: str = "",
        result_count: int = 1,
    ) -> None:
        await ThirdPartyAccessLog(
            id=new_ulid(),
            client_id=claims.client_id,
            module_name=claims.module_name,
            endpoint=endpoint,
            location_code=location_code,
            purpose="",
            ip=client_ip,
            status=outcome,
            result_count=result_count if outcome in ("granted", "granted_bypass") else 0,
            created_at=datetime.now(UTC),
        ).insert()

    async def _log_detached(self, *, booking_id: str, **log: Any) -> None:
        """Best-effort access log that cancelling the request cannot interrupt.

        Never raises on a write failure (only the booking_id and exception type are logged).
        """

        async def write() -> None:
            try:
                await self._log(**log)
            except Exception as exc:
                logger.warning(
                    "access log write failed (booking_id=%s error=%s)",
                    booking_id,
                    type(exc).__name__,
                )

        await asyncio.shield(_detach(write()))

    async def _deny(
        self,
        *,
        endpoint: str,
        claims: ThirdPartyClaims,
        client_ip: str,
        status_code: int,
        code: str,
        message: str,
        location_code: str = "",
        detail: str | None = None,
    ) -> HTTPException:
        await self._log(
            endpoint=endpoint,
            claims=claims,
            client_ip=client_ip,
            outcome=f"denied_{code}",
            location_code=location_code,
        )
        return _error(status_code, code, message, detail)

    async def _require_scope(
        self, *, endpoint: str, claims: ThirdPartyClaims, client_ip: str
    ) -> None:
        if _REQUIRED_SCOPE not in claims.scopes:
            raise await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_403_FORBIDDEN,
                code="insufficient_scope",
                message=f"scope '{_REQUIRED_SCOPE}' is required",
            )

    async def _load_owned_group(
        self, *, booking_id: str, endpoint: str, claims: ThirdPartyClaims, client_ip: str
    ) -> list[ExternalBooking]:
        """FR-30/36 — another client's booking is indistinguishable from a missing one.

        Rows still being staged (`committed=False`) are invisible; rows written before
        CR-169 have no `committed` key and are a group of one. A group is only visible once
        every one of its rows is (the commit flip is not atomic), else it reads as missing.
        """
        rows = (
            await ExternalBooking.find(
                {
                    "booking_id": booking_id,
                    "client_id": claims.client_id,
                    "committed": {"$ne": False},
                }
            )
            .sort("person_seq")
            .to_list()
        )
        if not rows or not _is_complete_group(rows):
            raise await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_404_NOT_FOUND,
                code="booking_not_found",
                message="Booking not found.",
            )
        return rows

    # --- EXT-008 -------------------------------------------------------------------

    async def _resolve_in_progress(
        self,
        *,
        existing: ExternalBookingIdempotency,
        location_code: str,
        persons_count: int,
        claims: ThirdPartyClaims,
        client_ip: str,
    ) -> BookingCreatedEnvelope | None:
        """#614 decision sync — an `in_progress` key row decides by its age and real rows.

        Younger than 60 s → 409 `idempotency_in_progress`. Older: every row of its `booking_id`
        committed → 201 with the original booking, key completed. No committed row → the stale
        key is taken over (None: the caller proceeds as new; only one of several racing requests
        wins) and this attempt's staged rows are removed. Some but not all committed → 409; when
        no staged row is left (the sweeper never reaches such a group) the claim also removes the
        rest of the group, so the next stale retry proceeds as new.
        """

        async def busy() -> HTTPException:
            return await self._deny(
                endpoint=ENDPOINT_CREATE,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_409_CONFLICT,
                code="idempotency_in_progress",
                message="A request with this Idempotency-Key is still being processed.",
                location_code=location_code,
            )

        age = datetime.now(UTC) - _aware(existing.created_at)
        if age < timedelta(seconds=_IN_PROGRESS_STALE_SECONDS):
            raise await busy()
        collection = ExternalBooking.get_pymongo_collection()
        committed = await _committed_count(collection, existing.booking_id)
        if committed is None:
            raise await busy()
        if 0 < committed < persons_count:
            staged = await _staged_count(collection, existing.booking_id)
            if staged != 0:
                # Partly committed with staged rows: 409 and nothing is touched; the worker
                # sweeper removes the group (FR-33), after which the next retry takes over.
                raise await busy()
            # Partly committed and nothing staged: a removal that gave up (claim or failed
            # commit) left it, and the sweeper never reaches a group without staged rows. The
            # claim removes the rest of the group and answers busy (409).
        if committed < persons_count:
            outcome = await _claim_stale_key(existing, persons_count)
            if outcome == "busy":
                raise await busy()
            if outcome == "free":
                # The key is ours and no booking was made: this request proceeds as new.
                return None
        else:
            # Guarded by the lease value read above: a claim that renewed it decides instead.
            await _complete_key(existing.id, existing.created_at, existing.booking_id)
        # Every row of the group is committed: the booking exists, answer it as the original.
        await self._log(
            endpoint=ENDPOINT_CREATE,
            claims=claims,
            client_ip=client_ip,
            outcome="granted",
            location_code=location_code,
            result_count=persons_count,
        )
        return _created_envelope(existing.booking_id, location_code, persons_count)

    async def _answer_existing(
        self,
        *,
        existing: ExternalBookingIdempotency,
        request_hash: str,
        location_code: str,
        persons_count: int,
        claims: ThirdPartyClaims,
        client_ip: str,
    ) -> BookingCreatedEnvelope | None:
        """#614 — answer a request whose Idempotency-Key already has a row.

        Different payload → 409 `idempotency_key_reused`; same payload completed → the original
        201 body; same payload in progress → see `_resolve_in_progress`. Returns None when a
        stale in_progress key was taken over: the caller then proceeds as a new request.
        """
        endpoint = ENDPOINT_CREATE
        if existing.request_hash != request_hash:
            raise await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_409_CONFLICT,
                code="idempotency_key_reused",
                message="Idempotency-Key was already used with a different request.",
                location_code=location_code,
            )
        if existing.status != "completed":
            return await self._resolve_in_progress(
                existing=existing,
                location_code=location_code,
                persons_count=persons_count,
                claims=claims,
                client_ip=client_ip,
            )
        await self._log(
            endpoint=endpoint,
            claims=claims,
            client_ip=client_ip,
            outcome="granted",
            location_code=location_code,
            result_count=persons_count,
        )
        return _created_envelope(existing.booking_id, location_code, persons_count)

    async def _reserve_key(
        self,
        *,
        key: str,
        request_hash: str,
        booking_id: str,
        now: datetime,
        location_code: str,
        persons_count: int,
        claims: ThirdPartyClaims,
        client_ip: str,
    ) -> str | BookingCreatedEnvelope:
        """Insert the in_progress row (unique per client_id + key).

        Returns the new row id, or the answer to a request that won the race for the key.
        """
        for _ in range(2):
            record = ExternalBookingIdempotency(
                id=f"IK-{new_ulid()}",
                client_id=claims.client_id,
                key=key,
                request_hash=request_hash,
                booking_id=booking_id,
                status="in_progress",
                created_at=now,
            )
            try:
                await record.insert()
            except DuplicateKeyError:
                existing = await ExternalBookingIdempotency.find_one(
                    ExternalBookingIdempotency.client_id == claims.client_id,
                    ExternalBookingIdempotency.key == key,
                )
                if existing is not None:
                    answer = await self._answer_existing(
                        existing=existing,
                        request_hash=request_hash,
                        location_code=location_code,
                        persons_count=persons_count,
                        claims=claims,
                        client_ip=client_ip,
                    )
                    if answer is not None:
                        return answer
                # The first request released its key (or a stale key was taken over): try again.
                continue
            except BaseException:
                # The insert may have been applied before its acknowledgement was lost, or the
                # request was cancelled. Remove only this request's own row (never the winner's).
                await _release_key(record.id, record.created_at, booking_id)
                raise
            return record.id
        raise await self._deny(
            endpoint=ENDPOINT_CREATE,
            claims=claims,
            client_ip=client_ip,
            status_code=status.HTTP_409_CONFLICT,
            code="idempotency_in_progress",
            message="A request with this Idempotency-Key is still being processed.",
            location_code=location_code,
        )

    async def _taken_cid_hashes(self, location_code: str, cid_hashes: list[str]) -> set[str]:
        """The CID hashes that already hold a place at `location_code` (FR-17/20, D5).

        Covers projected holds and open buffered bookings; rows still staged by another
        request (`committed: False`) are excluded, the unique index decides that race.
        """
        held = (
            await PublicPerson.get_pymongo_collection()
            .find(
                {
                    "national_id_hash": {"$in": cid_hashes},
                    "shelter_code": location_code,
                    "status": {"$in": list(HOLD_STATUSES)},
                },
                {"national_id_hash": 1},
            )
            .to_list()
        )
        buffered = (
            await ExternalBooking.get_pymongo_collection()
            .find(
                {
                    "shelter_code": location_code,
                    "cid_hash": {"$in": cid_hashes},
                    "state": {"$in": list(OPEN_BOOKING_STATES)},
                    # Rows other requests are still staging may yet be rolled back; the
                    # unique index decides that race at insert time.
                    "committed": {"$ne": False},
                },
                {"cid_hash": 1},
            )
            .to_list()
        )
        return {row["national_id_hash"] for row in held} | {row["cid_hash"] for row in buffered}

    async def _lowest_duplicate_index(
        self, location_code: str, cid_hashes: list[str], fallback: int
    ) -> int:
        """Lowest `persons[]` index that collides, re-checked after an insert-time race.

        The insert runs in `cid_hash` order, so the unique-index error names only the first
        colliding row. Re-run the pre-check to report the lowest index, matching it. Falls
        back to the colliding row's index when the re-check finds nothing or fails.

        `_taken_cid_hashes` skips `committed: False` rows of other requests, so a colliding
        row that is still staged by another request is not seen here. The fallback then
        reports the colliding row's own index, which may not be the lowest. This is the
        spec's fallback, not a defect.
        """
        try:
            taken = await self._taken_cid_hashes(location_code, cid_hashes)
        except Exception as exc:
            logger.warning("duplicate re-check failed (error=%s)", type(exc).__name__)
            return fallback
        colliding = [index for index, cid_hash in enumerate(cid_hashes) if cid_hash in taken]
        return min(colliding) if colliding else fallback

    async def create_booking(
        self,
        *,
        body: BookingCreateRequest,
        claims: ThirdPartyClaims,
        client_ip: str,
        idempotency_key: str | None = None,
    ) -> BookingCreatedEnvelope:
        endpoint = ENDPOINT_CREATE
        await self._require_scope(endpoint=endpoint, claims=claims, client_ip=client_ip)

        location_code = _clean(body.location_code)

        async def invalid(message: str) -> HTTPException:
            return await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="validation_error",
                message=message,
                location_code=location_code,
            )

        if idempotency_key is not None and not 1 <= len(idempotency_key) <= _MAX_IDEMPOTENCY_KEY:
            raise await invalid(
                f"Idempotency-Key must be between 1 and {_MAX_IDEMPOTENCY_KEY} characters."
            )

        # D1 — the legacy single-person body is a `persons` array of one.
        legacy = (body.cid, body.first_name, body.last_name, body.phone)
        if body.persons is not None:
            if any(value is not None for value in legacy):
                raise await invalid(
                    "Send either persons[] or cid/first_name/last_name/phone, not both."
                )
            raw_persons = body.persons
            prefixes = [f"persons[{i}]." for i in range(len(raw_persons))]
        else:
            raw_persons = [
                BookingPersonInput(
                    cid=body.cid,
                    first_name=body.first_name,
                    last_name=body.last_name,
                    phone=body.phone,
                )
            ]
            prefixes = [""]
        if not 1 <= len(raw_persons) <= MAX_PERSONS:
            raise await invalid(f"persons must contain between 1 and {MAX_PERSONS} items.")

        # Report every bad person at once — a group may hold up to MAX_PERSONS people.
        persons: list[_Person] = []
        missing = [] if location_code else ["location_code"]
        problems: list[str] = []
        for raw, prefix in zip(raw_persons, prefixes, strict=True):
            person, person_missing, person_problems = _validate_person(raw, prefix)
            persons.append(person)
            missing += person_missing
            problems += person_problems
        if missing:
            problems.insert(0, f"Required fields missing or blank: {', '.join(missing)}.")
        first_seen: dict[str, int] = {}
        for index, person in enumerate(persons):  # FR-4
            if not person.cid:
                continue
            if person.cid in first_seen:
                problems.append(
                    f"{prefixes[index]}cid duplicates {prefixes[first_seen[person.cid]]}cid."
                )
            else:
                first_seen[person.cid] = index
        if problems:
            raise await invalid(" ".join(problems))

        request_hash = _request_hash(location_code, persons)
        if idempotency_key is not None:
            # #614 — a retry of an earlier request is answered before any duplicate check,
            # since that earlier request now holds the places.
            existing = await ExternalBookingIdempotency.find_one(
                ExternalBookingIdempotency.client_id == claims.client_id,
                ExternalBookingIdempotency.key == idempotency_key,
            )
            if existing is not None:
                answer = await self._answer_existing(
                    existing=existing,
                    request_hash=request_hash,
                    location_code=location_code,
                    persons_count=len(persons),
                    claims=claims,
                    client_ip=client_ip,
                )
                if answer is not None:
                    return answer
                # A stale in_progress key was taken over: this request proceeds as new.

        shelter = await PublicShelter.find_one(PublicShelter.shelter_code == location_code)
        if shelter is None or not shelter.is_active:
            raise await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_404_NOT_FOUND,
                code="location_not_found",
                message="Location not found.",
                location_code=location_code,
            )

        # #751 (CR-154/CR-169 rule change) — the normal rule is `accepts_booking`: not closed AND
        # the pre-registration switch is on (a missing flag is NOT bookable). `booking-bypass`
        # (EOC) skips it, so bypass is only "used" when the rule actually fails. The 404 above
        # still wins: an unknown / inactive shelter is never bookable, bypass or not.
        bookable = accepts_booking(shelter)
        bypass = not bookable and _BYPASS_SCOPE in claims.scopes
        if not bookable and not bypass:
            raise await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_409_CONFLICT,
                code="location_not_bookable",
                message="Location does not accept bookings.",
                location_code=location_code,
            )

        cid_hashes = [national_id_hash(person.cid) for person in persons]

        async def duplicate(index: int) -> HTTPException:
            # FR-20 — the index of the first duplicate only; never the CID.
            return await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_409_CONFLICT,
                code="duplicate_booking",
                message="This person already holds a booking at this location.",
                location_code=location_code,
                detail=f"persons[{index}]",
            )

        now = datetime.now(UTC)
        booking_id = f"BK-{new_ulid()}"
        # #614 — the key is reserved before the duplicate check: a same-key request that overlaps
        # this one meets the key row (in_progress / completed) instead of this request's rows,
        # which the duplicate check would otherwise see as committed. Every failure path below
        # releases it.
        reserved_id: str | None = None
        if idempotency_key is not None:
            reserved = await self._reserve_key(
                key=idempotency_key,
                request_hash=request_hash,
                booking_id=booking_id,
                now=now,
                location_code=location_code,
                persons_count=len(persons),
                claims=claims,
                client_ip=client_ip,
            )
            if isinstance(reserved, BookingCreatedEnvelope):
                return reserved
            reserved_id = reserved
        try:
            # FR-17/20 — duplicates are checked per shelter only (D5), for the whole group
            # before anything is inserted.
            taken = await self._taken_cid_hashes(location_code, cid_hashes)
            for index, cid_hash in enumerate(cid_hashes):
                if cid_hash in taken:
                    raise await duplicate(index)
        except BaseException:
            await _release_key(reserved_id, now, booking_id)
            raise
        # Inserting in `cid_hash` order means two overlapping groups collide on the same
        # key first, so one of them wins instead of each blocking the other half-way.
        rows = [
            ExternalBooking(
                id=f"BP-{new_ulid()}",
                booking_id=booking_id,
                person_seq=index,
                group_size=len(persons),
                committed=False,
                bypass=bypass,
                client_id=claims.client_id,
                module_name=claims.module_name,
                shelter_code=location_code,
                cid=person.cid,
                cid_hash=cid_hash,
                first_name=person.first_name,
                last_name=person.last_name,
                phone=person.phone,
                state="pending",
                created_at=now,
                updated_at=now,
            )
            for index, (person, cid_hash) in enumerate(zip(persons, cid_hashes, strict=True))
        ]
        rows.sort(key=lambda row: row.cid_hash)
        collection = ExternalBooking.get_pymongo_collection()
        # Staged rows hold plaintext PII, so a failed request must not leave them behind.
        # The insert runs as its own task: if the request is cancelled mid-flight, cleanup
        # waits for it to settle first, otherwise it could miss rows mongod applies later.
        # Cleanup is shielded so a cancelled request (client disconnect) cannot abort it.
        # Rows orphaned by a hard process kill stay `committed=False` and are ignored by
        # the worker poll; the worker sweeper (`sweep_stale_staged`, CR-169 FR-33) deletes
        # them, plus any `pending` rows of the same `booking_id`, once older than 60s.
        # The `except` blocks below only record the outcome: cleanup, audit and the final
        # raise happen after them so the `BulkWriteError` (whose details embed the rows) is
        # never in the `__context__` chain of anything raised later.
        staged = {"booking_id": booking_id, "committed": False}
        insert_task = _detach(ExternalBooking.insert_many(rows, ordered=True))
        duplicate_seq: int | None = None
        failure: Exception | None = None
        audit_failure = False  # only the sanitized 500; other errors propagate as raised
        try:
            await asyncio.shield(insert_task)
        except asyncio.CancelledError:
            await _cleanup_staged(collection, staged, after=insert_task)
            await _release_key(reserved_id, now, booking_id)
            raise
        except BulkWriteError as exc:
            # Race guard: the unique partial index on (shelter_code, cid_hash).
            write_errors = exc.details.get("writeErrors") or []
            if write_errors and write_errors[0].get("code") == _DUPLICATE_KEY_CODE:
                duplicate_seq = rows[write_errors[0]["index"]].person_seq
            else:
                # Log only the error codes and fail with something that carries no document.
                codes = [e.get("code") for e in write_errors if isinstance(e.get("code"), int)]
                logger.error(
                    "staged booking insert failed (booking_id=%s codes=%s)", booking_id, codes
                )
                failure = _error(
                    status.HTTP_500_INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "The booking could not be saved.",
                )
                audit_failure = True
        except Exception as exc:
            failure = exc
        if duplicate_seq is not None or failure is not None:
            await _cleanup_staged(collection, staged)
            await _release_key(reserved_id, now, booking_id)
            if duplicate_seq is not None:
                raise await duplicate(
                    await self._lowest_duplicate_index(location_code, cid_hashes, duplicate_seq)
                )
            if audit_failure:
                await self._log_detached(
                    booking_id=booking_id,
                    endpoint=endpoint,
                    claims=claims,
                    client_ip=client_ip,
                    outcome="denied_internal_error",
                    location_code=location_code,
                )
            raise failure

        # #614 fence — the key may have been taken over while this attempt was staging rows
        # (stalled past 60 s). Then this attempt must not commit: its rows are removed and the
        # new owner of the key answers the partner.
        try:
            owns_key = await _still_owns_key(reserved_id, now)
        except BaseException:
            await _cleanup_staged(collection, staged)
            await _release_key(reserved_id, now, booking_id)
            raise
        if not owns_key:
            # Taken over (or the check failed): remove this attempt's rows. The lease-guarded
            # release frees the key only when it is still this attempt's own (a failed read).
            await _cleanup_staged(collection, staged)
            await _release_key(reserved_id, now, booking_id)
            raise await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_409_CONFLICT,
                code="idempotency_in_progress",
                message="A request with this Idempotency-Key is still being processed.",
                location_code=location_code,
            )

        commit_failed = False
        key_completed = False  # set when the G5 settle already completed the key
        # The flip runs as its own task so a cancelled request cannot leave it half-awaited:
        # `update_many` may still be applied server-side after the cancel.
        commit_task = _detach(_commit_group(collection, booking_id, len(rows)))
        try:
            await asyncio.shield(commit_task)
        except asyncio.CancelledError:
            await _settle_cancelled_commit(
                collection,
                commit_task,
                booking_id=booking_id,
                group_size=len(rows),
                record_id=reserved_id,
                created_at=now,
            )
            raise
        except Exception:
            commit_failed = True  # recorded here; handled below the except block
        if commit_failed:
            # G5 (count) and the failure cleanup run shielded and detached, so a cancel that
            # lands during them cannot skip the key release or leave staged rows behind.
            kept = await asyncio.shield(
                _detach(
                    _settle_failed_commit(
                        collection,
                        booking_id=booking_id,
                        group_size=len(rows),
                        record_id=reserved_id,
                        created_at=now,
                    )
                )
            )
            # G5 — when every row is committed although the flip raised, the group stands and
            # the answer is 201 (the worker processes it) instead of a 500 that makes the partner
            # retry.
            commit_failed = not kept
            key_completed = kept
        if commit_failed:
            await self._log_detached(
                booking_id=booking_id,
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                outcome="denied_internal_error",
                location_code=location_code,
            )
            # Same sanitized 500 as the insert-failure path (partner `internal_error`
            # body, no exception text); `_with_retry` already logged the error type.
            raise _error(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "internal_error",
                "The booking could not be saved.",
            )

        if not key_completed:
            await _complete_key(reserved_id, now, booking_id)
        # The group is committed and the worker will process it: a failing or cancelled
        # access log must not turn this into an error (the partner's retry would then hit 409).
        with contextlib.suppress(asyncio.CancelledError):
            await self._log_detached(
                booking_id=booking_id,
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                outcome="granted_bypass" if bypass else "granted",
                location_code=location_code,
                result_count=len(persons),
            )
        return BookingCreatedEnvelope(
            result=BookingCreatedResult(
                booking_id=booking_id, location_code=location_code, persons_count=len(persons)
            )
        )

    # --- EXT-009 -------------------------------------------------------------------

    async def cancel_booking(
        self,
        *,
        booking_id: str,
        body: BookingCancelRequest | None,
        claims: ThirdPartyClaims,
        client_ip: str,
    ) -> BookingCancelledEnvelope:
        endpoint = ENDPOINT_CANCEL
        await self._require_scope(endpoint=endpoint, claims=claims, client_ip=client_ip)

        reason = _clean(body.reason if body else None) or None
        if reason is not None and len(reason) > _MAX_CANCEL_REASON:
            raise await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="validation_error",
                message=f"reason must be at most {_MAX_CANCEL_REASON} characters.",
            )

        # This request's id: the `cancel_flag_token` of every flag it sets (CR-169 FR-40).
        token = new_ulid()
        rows = await self._load_owned_group(
            booking_id=booking_id, endpoint=endpoint, claims=claims, client_ip=client_ip
        )
        # One wait budget per request (CR-169 FR-40): every foreign flag met below shares it.
        deadline = asyncio.get_running_loop().time() + _FLAG_WAIT_SECONDS
        rows = await self._settle_foreign_flags(
            rows, token, deadline, endpoint=endpoint, claims=claims, client_ip=client_ip
        )
        open_rows = [row for row in rows if _is_open(row)]
        if not open_rows and not any(_booking_status(row) == "CANCELLED" for row in rows):
            # Every row is `rejected`: nothing was ever cancelled, so there is nothing to confirm.
            raise await self._not_cancellable(endpoint, claims, client_ip, rows[0])

        # FR-40 — phase 1 is read-only: one blocked open row leaves every row untouched.
        # Finished rows are skipped, so they are not classified at all.
        plan: list[tuple[ExternalBooking, Literal["direct", "request"]]] = []
        if open_rows:
            evacuee_ids = [
                row.evacuee_id for row in open_rows if row.state == "written" and row.evacuee_id
            ]
            people = (
                await PublicPerson.find({"_id": {"$in": evacuee_ids}}).to_list()
                if evacuee_ids
                else []
            )
            status_by_person = {person.id: person.status for person in people}
            for row in open_rows:
                kind = _classify_cancel(row, status_by_person)
                if kind is None:
                    raise await self._not_cancellable(endpoint, claims, client_ip, rows[0])
                plan.append((row, kind))

        collection = ExternalBooking.get_pymongo_collection()
        # `now` is the cancel marker: a row flagged by this request carries exactly this
        # `updated_at`, so a revert never touches a row flagged by someone else.
        now = _to_milliseconds(datetime.now(UTC))
        requested = [row for row, kind in plan if kind == "request"]
        direct = [row for row, kind in plan if kind == "direct"]
        # Every planned row: 2b can re-flag a pending row that became written (`_cancel_row`),
        # so the revert after 2a must cover those rows too, not only `requested`.
        planned = [row for row, _ in plan]
        # Phase 2 is two `update_many` steps (no per-row loop on the common path). The written
        # rows are flagged first, so a check-in that lands meanwhile is caught before any
        # pending row is cancelled. Accepted residual risk (owner decision, CR-169 decision
        # sync 2026-10-17, review of PR #635): a step-2b conflict can still leave the pending
        # rows that 2b already cancelled stay cancelled while the 409 is returned (the bulk
        # cancel clears PII and cannot be rolled back). Closed only by #616 (atomic group
        # commit). The flags set in step 2a are reverted on that 409 (CR-169 FR-40,
        # all-or-nothing for the flags). The retry skips the cancelled rows (FINISHED).
        #
        # Token lifecycle (CR-169 decision sync 2026-10-17, review round 2 of PR #635): every
        # flag this request sets carries its `cancel_flag_token` (+ `cancel_flag_set_at`), and
        # the worker does not act on a flag that still carries a token. The token is cleared
        # only (a) by `_commit_flags` once the request has succeeded, which hands the flags to
        # the worker, or (b) by a successful `_revert_flags`, which removes the flags with it.
        # There is no unconditional clear: if a revert keeps failing, or the process dies before
        # it, flag + token stay. Later requests then wait their 1 s budget and answer 409, and
        # the worker reverts the flag once its token is older than 2 minutes (the partner never
        # got a 200 for it), without cancelling anything.
        if requested and not await self._flag_requested(
            collection, requested, reason, now, token, deadline
        ):
            raise await self._not_cancellable(endpoint, claims, client_ip, rows[0])
        # Any unexpected error after phase 2a reverts the flags this request set (guarded by
        # `now` and `token`), so it never hands `cancel_requested=True` to the worker. A 409
        # from 2b reverts them the same way before it is returned.
        if direct:
            try:
                cancelled = await self._cancel_pending(
                    collection, direct, reason, now, token, deadline
                )
            except BaseException:
                await self._revert_after_error(collection, planned, now, token)
                raise
            if not cancelled:
                await self._revert_after_error(collection, planned, now, token)
                raise await self._not_cancellable(endpoint, claims, client_ip, rows[0])
        # Phase 2c — the granted access-log write, then the commit of the flags (token clear).
        # An error in either reverts the flags, so the partner never gets a 200 for flags that
        # were not handed to the worker. There is no limit on how long a request may hold its
        # flags before committing (the owner rejected a 60 s hold rule, CR-169 decision sync
        # 2026-10-17, review round 3 of PR #635).
        #
        # Accepted residual risks (same decision; each needs Mongo to fail mid-command or to be
        # slower than about a minute; closed only by #616, replica set / transaction, if seen in
        # production):
        # - a commit that cleared only some tokens before Mongo failed leaves those rows
        #   FINISHED (the revert is guarded on the token, so it reverts only the rest) while
        #   the request answers 500;
        # - a token clear that runs past the worker's 2-minute token TTL: the worker may already
        #   have reverted those flags as abandoned although the request then answers 200;
        # - a commit that fails after the granted access log leaves that log entry on a request
        #   answered 500;
        # - a client disconnect during the commit lets the detached token clear run on while
        #   the handler below starts a detached revert; both are guarded only on the token, so
        #   which rows end committed vs reverted is not determined (the partner got no response).
        # A partner retry settles each of them.
        try:
            result = await self._cancelled(endpoint, claims, client_ip, rows[0])
            if planned:
                await self._commit_flags(collection, planned, token)
            return result
        except BaseException:
            await self._revert_after_error(collection, planned, now, token)
            raise

    async def _settle_foreign_flags(
        self,
        rows: list[ExternalBooking],
        token: str,
        deadline: float,
        *,
        endpoint: str,
        claims: ThirdPartyClaims,
        client_ip: str,
    ) -> list[ExternalBooking]:
        """CR-169 FR-40 — wait on other requests' in-flight cancel flags, within `deadline`.

        `deadline` is the request's single wait budget (`_FLAG_WAIT_SECONDS` from its start), shared
        by every later step. A flag still in flight when the wait ends is a conflict: this request
        cannot tell whether the row will be cancelled, so it is refused before it flags anything.
        """
        if not any(_foreign_flag(row, token) for row in rows):
            return rows
        settled: list[ExternalBooking] = []
        for row in rows:
            if _foreign_flag(row, token):
                fresh = await self._await_foreign_flag(row, token, deadline)
                if fresh is None:
                    raise await self._not_cancellable(endpoint, claims, client_ip, rows[0])
                row = fresh
            settled.append(row)
        return settled

    async def _await_foreign_flag(
        self, row: ExternalBooking, token: str, deadline: float
    ) -> ExternalBooking | None:
        """Re-read `row` until another request's flag settles; None if still in flight.

        Settled means the token was cleared (the row is FINISHED and the flag stays) or the flag
        was reverted (the row is OPEN again). A row that vanished counts as unsettled.
        """
        loop = asyncio.get_running_loop()
        current = row
        while _foreign_flag(current, token):
            if loop.time() >= deadline:
                break
            await asyncio.sleep(_FLAG_POLL_SECONDS)
            fresh = await ExternalBooking.get(row.id)
            if fresh is None:
                return None
            current = fresh
        if not _foreign_flag(current, token):
            return current
        # The shared budget is spent. The other request may have settled the flag between the
        # last poll and now, so re-read the row once more before the 409: token gone → FINISHED
        # (skipped by the caller), flag reverted → OPEN (cancelled by the caller).
        fresh = await ExternalBooking.get(row.id)
        if fresh is None or _foreign_flag(fresh, token):
            logger.warning("cancel flag still in flight (booking_id=%s)", row.booking_id)
            return None
        return fresh

    async def _flag_requested(
        self,
        collection: Any,
        rows: list[ExternalBooking],
        reason: str | None,
        now: datetime,
        token: str,
        deadline: float,
    ) -> bool:
        """Phase 2a (FR-32) — flag the written rows for the worker. False after a full revert.

        Any exception raised while flagging or re-reading the stays reverts the flags this
        request set before it propagates (see `_revert_after_error`).
        """
        try:
            return await self._flag_and_check(collection, rows, reason, now, token, deadline)
        except BaseException:
            await self._revert_after_error(collection, rows, now, token)
            raise

    async def _flag_and_check(
        self,
        collection: Any,
        rows: list[ExternalBooking],
        reason: str | None,
        now: datetime,
        token: str,
        deadline: float,
    ) -> bool:
        """Body of phase 2a: flag the written rows, then re-read their stays.

        One `update_many` guarded on `state: written` and `cancel_requested: False`. When it
        flags fewer rows than asked, the missed rows are re-evaluated one by one (they are
        FINISHED by someone else, or moved on and need a fresh flag). The stays of every row
        this request flagged are then read again: a check-in since phase 1 reverts the flags.

        A written row flagged by a concurrent request is waited on (`_cancel_row`): when its
        flag settles as FINISHED it is skipped, and when it is still in flight at the deadline
        this step is a 409, so the request cannot return 200 while that row stays open. Our own
        flags are reverted; the foreign flag is left alone.

        The worker cannot act on these flags while the request runs: they carry its token, and
        the worker skips tokened flags (CR-169 decision sync 2026-10-17, review round 2 of PR
        #635). A 409 from this step reverts the flags; a 409 from step 2b (`_cancel_pending`)
        reverts them too, in `cancel_booking`. A revert that fails leaves flag + token for the
        worker's 2-minute abandoned-token revert.
        """
        ids = [row.id for row in rows]
        result = await collection.update_many(
            {"_id": {"$in": ids}, "state": "written", "cancel_requested": False},
            {
                "$set": {
                    "cancel_requested": True,
                    "cancel_reason": reason,
                    "cancel_flag_token": token,
                    "cancel_flag_set_at": now,
                    "updated_at": now,
                }
            },
        )
        flagged: set[str] = set(ids)
        ok = True
        if result.modified_count < len(ids):
            flagged = set(await self._flagged_by(collection, ids, now, token))
            for row in rows:
                if row.id in flagged:
                    continue
                if not await self._cancel_row(
                    collection, row, "request", reason, now, token, deadline
                ):
                    ok = False
                    break
            flagged = set(await self._flagged_by(collection, ids, now, token))

        ours = [row for row in rows if row.id in flagged]
        if ok:
            evacuee_ids = [row.evacuee_id for row in ours if row.evacuee_id]
            people = (
                await PublicPerson.find({"_id": {"$in": evacuee_ids}}).to_list()
                if evacuee_ids
                else []
            )
            statuses = {person.id: person.status for person in people}
            ok = all(
                _stay_allows_cancel(statuses.get(row.evacuee_id) if row.evacuee_id else None)
                for row in ours
            )
        if not ok:
            # The 409 must win over a failing revert: `_revert_after_error` logs a failed revert
            # (booking_id and error type only) and never replaces the conflict outcome.
            await self._revert_after_error(collection, ours, now, token)
        return ok

    async def _flagged_by(
        self, collection: Any, ids: list[str], now: datetime, token: str
    ) -> list[str]:
        """The `ids` whose `cancel_requested` flag carries this request's marker and token."""
        docs = await collection.find(
            {
                "_id": {"$in": ids},
                "state": "written",
                "cancel_requested": True,
                "updated_at": now,
                "cancel_flag_token": token,
            },
            {"_id": 1},
        ).to_list()
        return [doc["_id"] for doc in docs]

    async def _revert_flags(
        self, collection: Any, rows: list[ExternalBooking], now: datetime, token: str
    ) -> None:
        """Undo the flags this request set and drop its token; other requests' flags stay intact.

        Shielded from cancellation (it runs as its own task, so a client disconnect cannot abort
        it half-way) and retried; the last failure is re-raised so the caller knows the flags
        and token are still in place. The write is idempotent and guarded on `now` and `token`.
        """
        ids = [row.id for row in rows]

        async def revert() -> None:
            await collection.update_many(
                {
                    "_id": {"$in": ids},
                    "state": "written",
                    "cancel_requested": True,
                    "updated_at": now,
                    "cancel_flag_token": token,
                },
                {
                    "$set": {
                        "cancel_requested": False,
                        "cancel_reason": None,
                        "cancel_flag_token": None,
                        "cancel_flag_set_at": None,
                        "updated_at": _to_milliseconds(datetime.now(UTC)),
                    }
                },
            )

        await asyncio.shield(
            _detach(
                _with_retry(
                    revert,
                    what="cancel flag revert attempt",
                    booking_id=rows[0].booking_id,
                    attempts=_CANCEL_ROW_ATTEMPTS,
                    reraise=True,
                    give_up="cancel flag revert gave up",
                )
            )
        )

    async def _revert_after_error(
        self, collection: Any, rows: list[ExternalBooking], now: datetime, token: str
    ) -> None:
        """Revert the flags of `rows` before an unexpected error (or a 409) is re-raised.

        Called from an exception handler or from a 409 path, so a revert that still fails after
        its retries is logged (booking_id and error type only, no PII) and never replaces the
        original outcome. Flag and token are then left in place on purpose (CR-169 decision sync
        2026-10-17, review round 2 of PR #635): the worker skips a tokened flag and reverts it
        once the token is older than 2 minutes. Rows not flagged by this request do not carry
        its marker and token, so the guarded revert leaves them alone.

        The revert runs as a shielded task: when the request itself is cancelled while waiting
        for it, the `CancelledError` propagates here but the revert task carries on.
        """
        if not rows:
            return
        try:
            await self._revert_flags(collection, rows, now, token)
        except Exception as exc:
            logger.error(
                "cancel flag revert failed (booking_id=%s error=%s)",
                rows[0].booking_id,
                type(exc).__name__,
            )

    async def _commit_flags(self, collection: Any, rows: list[ExternalBooking], token: str) -> None:
        """Hand this request's flags to the worker by clearing its token (CR-169 FR-40).

        Only called once the request has succeeded. A failure after the retries is re-raised so
        the caller reverts and answers 500 instead of 200 (the worker would otherwise revert a
        flag the partner was told is cancelled). No hold-time limit applies (CR-169 decision
        sync 2026-10-17, review round 3 of PR #635); a clear that runs past the worker's
        2-minute token TTL is an accepted residual (see `cancel_booking`), closed only by #616.
        """
        await self._clear_flag_tokens(collection, rows, token)

    async def _clear_flag_tokens(
        self, collection: Any, rows: list[ExternalBooking], token: str
    ) -> None:
        """Clear this request's `cancel_flag_token` (and its set time); the flags stay.

        Guarded on `token`, so a row carrying another request's token keeps it, and a row whose
        flag the worker already reverted is not touched. A row that is still `cancel_requested`
        is then FINISHED for later requests and due for the worker. Shielded and retried like
        the revert; the last failure is re-raised (see `_commit_flags`).
        """
        ids = [row.id for row in rows]

        async def clear() -> None:
            await collection.update_many(
                {"_id": {"$in": ids}, "cancel_flag_token": token},
                {"$set": {"cancel_flag_token": None, "cancel_flag_set_at": None}},
            )

        await asyncio.shield(
            _detach(
                _with_retry(
                    clear,
                    what="cancel flag token clear",
                    booking_id=rows[0].booking_id,
                    attempts=_CANCEL_ROW_ATTEMPTS,
                    reraise=True,
                    give_up="cancel flag token could not be cleared",
                )
            )
        )

    async def _cancel_pending(
        self,
        collection: Any,
        rows: list[ExternalBooking],
        reason: str | None,
        now: datetime,
        token: str,
        deadline: float,
    ) -> bool:
        """Phase 2b (FR-31) — cancel the pending rows and clear their PII in one `update_many`.

        A pending row that missed the guarded update moved on meanwhile: a FINISHED row is
        skipped (success), a row now written and cancellable is flagged, anything else → False.
        An exception raised here (including the per-row re-read) propagates to `cancel_booking`,
        which reverts the step 2a flags before re-raising.
        """
        ids = [row.id for row in rows]
        result = await collection.update_many(
            {"_id": {"$in": ids}, "state": "pending"},
            {
                "$set": {
                    "state": "cancelled",
                    "cancel_reason": reason,
                    "cid": None,
                    "first_name": None,
                    "last_name": None,
                    "phone": None,
                    "updated_at": now,
                }
            },
        )
        if result.modified_count == len(ids):
            return True
        docs = await collection.find(
            {"_id": {"$in": ids}, "state": "cancelled", "updated_at": now}, {"_id": 1}
        ).to_list()
        cancelled = {doc["_id"] for doc in docs}
        for row in rows:
            if row.id in cancelled:
                continue
            fresh = await ExternalBooking.get(row.id)
            if fresh is None:
                return False
            if _foreign_flag(fresh, token):
                fresh = await self._await_foreign_flag(fresh, token, deadline)
                if fresh is None:
                    return False
            if not _is_open(fresh):
                continue
            kind = await self._classify_fresh(fresh)
            if kind is None or not await self._cancel_row(
                collection, fresh, kind, reason, now, token, deadline
            ):
                return False
        return True

    async def _cancel_row(
        self,
        collection: Any,
        row: ExternalBooking,
        kind: Literal["direct", "request"],
        reason: str | None,
        now: datetime,
        token: str,
        deadline: float,
    ) -> bool:
        """Cancel one OPEN row that a bulk step missed. False only when it can no longer be.

        A guarded update that misses means the row moved on meanwhile (worker write, a concurrent
        cancel, or another request's in-flight flag). The fresh row is re-evaluated: a foreign
        flag is waited on, FINISHED → skipped (success), still OPEN and cancellable → retried
        with its new kind, anything else → conflict.
        """
        current, current_kind = row, kind
        # `attempts` is the number of guarded writes made when the loop ends, whether it ran
        # out of attempts or stopped early (row gone, or no longer cancellable).
        attempts = 0
        for _ in range(_CANCEL_ROW_ATTEMPTS):
            attempts += 1
            if await self._guarded_cancel(collection, current, current_kind, reason, now, token):
                return True
            fresh = await ExternalBooking.get(current.id)
            if fresh is None:
                logger.warning("cancel row no longer exists (booking_id=%s)", row.booking_id)
                return False
            if _foreign_flag(fresh, token):
                fresh = await self._await_foreign_flag(fresh, token, deadline)
                if fresh is None:
                    return False
            if not _is_open(fresh):
                return True
            next_kind = await self._classify_fresh(fresh)
            if next_kind is None:
                break
            current, current_kind = fresh, next_kind
        logger.warning(
            "cancel re-evaluation gave up (booking_id=%s attempts=%d)",
            row.booking_id,
            attempts,
        )
        return False

    async def _guarded_cancel(
        self,
        collection: Any,
        row: ExternalBooking,
        kind: Literal["direct", "request"],
        reason: str | None,
        now: datetime,
        token: str,
    ) -> bool:
        if kind == "direct":
            # FR-31 — guarded on state so a concurrent worker write is not overwritten.
            result = await collection.update_one(
                {"_id": row.id, "state": "pending"},
                {
                    "$set": {
                        "state": "cancelled",
                        "cancel_reason": reason,
                        "cid": None,
                        "first_name": None,
                        "last_name": None,
                        "phone": None,
                        "updated_at": now,
                    }
                },
            )
            return result.modified_count == 1
        result = await collection.update_one(
            {"_id": row.id, "state": "written", "cancel_requested": False},
            {
                "$set": {
                    "cancel_requested": True,
                    "cancel_reason": reason,
                    "cancel_flag_token": token,
                    "cancel_flag_set_at": now,
                    "updated_at": now,
                }
            },
        )
        return result.modified_count == 1

    async def _classify_fresh(self, row: ExternalBooking) -> Literal["direct", "request"] | None:
        person = await PublicPerson.get(row.evacuee_id) if row.evacuee_id else None
        statuses = {person.id: person.status} if person else {}
        return _classify_cancel(row, statuses)

    async def _cancelled(
        self,
        endpoint: str,
        claims: ThirdPartyClaims,
        client_ip: str,
        booking: ExternalBooking,
    ) -> BookingCancelledEnvelope:
        await self._log(
            endpoint=endpoint,
            claims=claims,
            client_ip=client_ip,
            outcome="granted",
            location_code=booking.shelter_code,
        )
        return BookingCancelledEnvelope(
            result=BookingCancelledResult(booking_id=booking.booking_id)
        )

    async def _not_cancellable(
        self,
        endpoint: str,
        claims: ThirdPartyClaims,
        client_ip: str,
        booking: ExternalBooking,
    ) -> HTTPException:
        return await self._deny(
            endpoint=endpoint,
            claims=claims,
            client_ip=client_ip,
            status_code=status.HTTP_409_CONFLICT,
            code="booking_not_cancellable",
            message="Booking can no longer be cancelled.",
            location_code=booking.shelter_code,
        )

    # --- EXT-010 -------------------------------------------------------------------

    async def get_booking(
        self, *, booking_id: str, claims: ThirdPartyClaims, client_ip: str
    ) -> BookingStatusEnvelope:
        endpoint = ENDPOINT_STATUS
        await self._require_scope(endpoint=endpoint, claims=claims, client_ip=client_ip)
        rows = await self._load_owned_group(
            booking_id=booking_id, endpoint=endpoint, claims=claims, client_ip=client_ip
        )
        statuses = [_booking_status(row) for row in rows]
        # FR-42 — aggregate, in order: no OPEN row and ≥1 CANCELLED → CANCELLED;
        # any REJECTED → REJECTED; else BOOKED.
        if not any(_is_open(row) for row in rows) and "CANCELLED" in statuses:
            booking_status: BookingStatus = "CANCELLED"
        elif "REJECTED" in statuses:
            booking_status = "REJECTED"
        else:
            booking_status = "BOOKED"
        reject_reason = next(
            (
                row.reject_reason
                for row, item in zip(rows, statuses, strict=True)
                if item == "REJECTED"
            ),
            None,
        )
        await self._log(
            endpoint=endpoint,
            claims=claims,
            client_ip=client_ip,
            outcome="granted",
            location_code=rows[0].shelter_code,
        )
        return BookingStatusEnvelope(
            result=BookingStatusResult(
                booking_id=booking_id,
                location_code=rows[0].shelter_code,
                booking_status=booking_status,
                reject_reason=reject_reason,
                persons=[
                    BookingPersonStatus(
                        index=row.person_seq, booking_status=item, reject_reason=row.reject_reason
                    )
                    for row, item in zip(rows, statuses, strict=True)
                ],
                created_at=_to_bangkok_iso(min(row.created_at for row in rows)),
                updated_at=_to_bangkok_iso(max(row.updated_at for row in rows)),
            )
        )


def get_thirdparty_bookings_use_case() -> ThirdPartyBookingsUseCase:
    return ThirdPartyBookingsUseCase()
