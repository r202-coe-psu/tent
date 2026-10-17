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
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from pymongo.errors import BulkWriteError
from tent_model.external_booking import OPEN_BOOKING_STATES, ExternalBooking
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from ...utils.masking import national_id_hash, normalize_phone
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
_BANGKOK_TZ = ZoneInfo("Asia/Bangkok")
_PHONE_RE = re.compile(r"^0\d{8,9}$")
_CID_RE = re.compile(r"^[0-9]{13}$")
_MAX_CANCEL_REASON = 200

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
            result_count=result_count if outcome == "granted" else 0,
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
        self, *, body: BookingCreateRequest, claims: ThirdPartyClaims, client_ip: str
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

        # FR-15/16 — only `closed` or an explicit opt-out blocks; full shelters stay bookable.
        feature_flags = shelter.raw_data.get("feature_flags") or {}
        if shelter.status == "closed" or feature_flags.get("accepts_pre_registration") is False:
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

        # FR-17/20 — duplicates are checked per shelter only (D5), for the whole group
        # before anything is inserted.
        taken = await self._taken_cid_hashes(location_code, cid_hashes)
        for index, cid_hash in enumerate(cid_hashes):
            if cid_hash in taken:
                raise await duplicate(index)

        now = datetime.now(UTC)
        booking_id = f"BK-{new_ulid()}"
        # Inserting in `cid_hash` order means two overlapping groups collide on the same
        # key first, so one of them wins instead of each blocking the other half-way.
        rows = [
            ExternalBooking(
                id=f"BP-{new_ulid()}",
                booking_id=booking_id,
                person_seq=index,
                group_size=len(persons),
                committed=False,
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

        commit_error: Exception | None = None
        try:
            await _commit_group(collection, booking_id, len(rows))
        except asyncio.CancelledError:
            await _cleanup_staged(collection, {"booking_id": booking_id, "state": "pending"})
            raise
        except Exception as exc:
            commit_error = exc
        if commit_error is not None:
            # The flip may have been applied to only some rows, so `committed` can no longer
            # tell this group's rows apart: remove every row of this booking_id that is still
            # `pending`. Rows the worker already advanced cannot be rolled back from here.
            await _cleanup_staged(collection, {"booking_id": booking_id, "state": "pending"})
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

        # The group is committed and the worker will process it: a failing or cancelled
        # access log must not turn this into an error (the partner's retry would then hit 409).
        with contextlib.suppress(asyncio.CancelledError):
            await self._log_detached(
                booking_id=booking_id,
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                outcome="granted",
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

        rows = await self._load_owned_group(
            booking_id=booking_id, endpoint=endpoint, claims=claims, client_ip=client_ip
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
        # pending row is cancelled. Residual race: a step-2b conflict can still leave the
        # pending rows cancelled while the 409 is returned, and the written rows flagged in
        # step 2a stay `cancel_requested=True` (the worker will still cancel them). The retry
        # skips the cancelled rows (FINISHED) and the flagged rows (not OPEN).
        if requested and not await self._flag_requested(collection, requested, reason, now):
            raise await self._not_cancellable(endpoint, claims, client_ip, rows[0])
        # Any unexpected error after phase 2a reverts the flags this request set (guarded by
        # `now`), so it never leaves `cancel_requested=True` behind. A 409 from 2b is the
        # documented residual race and keeps the flags, as before.
        if direct:
            try:
                cancelled = await self._cancel_pending(collection, direct, reason, now)
            except BaseException:
                await self._revert_after_error(collection, planned, now)
                raise
            if not cancelled:
                raise await self._not_cancellable(endpoint, claims, client_ip, rows[0])
        # Phase 2c — the granted access-log write after 2b. An error here reverts the 2a flags
        # too, so a failed 2c never leaves `cancel_requested=True` behind.
        try:
            return await self._cancelled(endpoint, claims, client_ip, rows[0])
        except BaseException:
            await self._revert_after_error(collection, planned, now)
            raise

    async def _flag_requested(
        self,
        collection: Any,
        rows: list[ExternalBooking],
        reason: str | None,
        now: datetime,
    ) -> bool:
        """Phase 2a (FR-32) — flag the written rows for the worker. False after a full revert.

        Any exception raised while flagging or re-reading the stays reverts the flags this
        request set before it propagates (see `_revert_after_error`).
        """
        try:
            return await self._flag_and_check(collection, rows, reason, now)
        except BaseException:
            await self._revert_after_error(collection, rows, now)
            raise

    async def _flag_and_check(
        self,
        collection: Any,
        rows: list[ExternalBooking],
        reason: str | None,
        now: datetime,
    ) -> bool:
        """Body of phase 2a: flag the written rows, then re-read their stays.

        One `update_many` guarded on `state: written` and `cancel_requested: False`. When it
        flags fewer rows than asked, the missed rows are re-evaluated one by one (they are
        FINISHED by someone else, or moved on and need a fresh flag). The stays of every row
        this request flagged are then read again: a check-in since phase 1 reverts the flags.

        Residual race: the worker may process a `cancel_requested` flag between the flag
        write below and the revert, so a stay that has just checked in can be asked to cancel.
        A 409 from this step reverts the flags; a 409 from step 2b (`_cancel_pending`) does not,
        so the rows flagged here stay `cancel_requested=True` and the worker will cancel them.
        """
        ids = [row.id for row in rows]
        result = await collection.update_many(
            {"_id": {"$in": ids}, "state": "written", "cancel_requested": False},
            {"$set": {"cancel_requested": True, "cancel_reason": reason, "updated_at": now}},
        )
        flagged: set[str] = set(ids)
        ok = True
        if result.modified_count < len(ids):
            flagged = set(await self._flagged_by(collection, ids, now))
            for row in rows:
                if row.id in flagged:
                    continue
                if not await self._cancel_row(collection, row, "request", reason, now):
                    ok = False
                    break
            flagged = set(await self._flagged_by(collection, ids, now))

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
        if not ok and flagged:
            await self._revert_flags(collection, sorted(flagged), now)
        return ok

    async def _flagged_by(self, collection: Any, ids: list[str], now: datetime) -> list[str]:
        """The `ids` whose `cancel_requested` flag carries this request's marker."""
        docs = await collection.find(
            {
                "_id": {"$in": ids},
                "state": "written",
                "cancel_requested": True,
                "updated_at": now,
            },
            {"_id": 1},
        ).to_list()
        return [doc["_id"] for doc in docs]

    async def _revert_flags(self, collection: Any, ids: list[str], now: datetime) -> None:
        """Undo the flags this request set; the marker keeps other requests' flags intact."""
        await collection.update_many(
            {"_id": {"$in": ids}, "state": "written", "cancel_requested": True, "updated_at": now},
            {
                "$set": {
                    "cancel_requested": False,
                    "cancel_reason": None,
                    "updated_at": _to_milliseconds(datetime.now(UTC)),
                }
            },
        )

    async def _revert_after_error(
        self, collection: Any, rows: list[ExternalBooking], now: datetime
    ) -> None:
        """Revert the flags of `rows` before an unexpected error is re-raised.

        Called from an exception handler, so a failing revert is logged (booking_id and error
        type only, no PII) and never replaces the original exception. Rows not flagged by this
        request do not carry the `now` marker and are left alone by the guarded revert.

        Only `Exception` is caught here. A `BaseException` such as `CancelledError` raised by
        the revert itself propagates and replaces the original error; that is accepted because
        cancellation already ends the request.
        """
        if not rows:
            return
        try:
            await self._revert_flags(collection, [row.id for row in rows], now)
        except Exception as exc:
            logger.error(
                "cancel flag revert failed (booking_id=%s error=%s)",
                rows[0].booking_id,
                type(exc).__name__,
            )

    async def _cancel_pending(
        self,
        collection: Any,
        rows: list[ExternalBooking],
        reason: str | None,
        now: datetime,
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
            if not _is_open(fresh):
                continue
            kind = await self._classify_fresh(fresh)
            if kind is None or not await self._cancel_row(collection, fresh, kind, reason, now):
                return False
        return True

    async def _cancel_row(
        self,
        collection: Any,
        row: ExternalBooking,
        kind: Literal["direct", "request"],
        reason: str | None,
        now: datetime,
    ) -> bool:
        """Cancel one OPEN row that a bulk step missed. False only when it can no longer be.

        A guarded update that misses means the row moved on meanwhile (worker write or a
        concurrent cancel). The fresh row is re-evaluated: FINISHED → skipped (success),
        still OPEN and cancellable → retried with its new kind, anything else → conflict.
        """
        current, current_kind = row, kind
        # `attempts` is the number of guarded writes made when the loop ends, whether it ran
        # out of attempts or stopped early (row gone, or no longer cancellable).
        attempts = 0
        for _ in range(_CANCEL_ROW_ATTEMPTS):
            attempts += 1
            if await self._guarded_cancel(collection, current, current_kind, reason, now):
                return True
            fresh = await ExternalBooking.get(current.id)
            if fresh is None:
                logger.warning("cancel row no longer exists (booking_id=%s)", row.booking_id)
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
            {"$set": {"cancel_requested": True, "cancel_reason": reason, "updated_at": now}},
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
