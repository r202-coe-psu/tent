"""Use case for EXT-008–010 partner bookings (M2, CR-154 C3/C4 FR-10..20, FR-30..36).

FastAPI never touches CouchDB: an accepted booking is a row in `external_bookings`
(schema.md §9.7) that the sync worker writes into `shelter_{code}` asynchronously.

The scope is checked here (not on the router) so denied attempts are still logged, and
every attempt lands in `third_party_access_logs` — never with the CID, phone or names.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError
from tent_model.external_booking import OPEN_BOOKING_STATES, ExternalBooking
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from ...utils.masking import national_id_hash, normalize_phone
from ...utils.thai_id import is_valid_thai_national_id
from ...utils.ulid import new_ulid
from ..thirdparty_auth.scopes import ThirdPartyClaims
from .schemas import (
    BookingCancelledEnvelope,
    BookingCancelledResult,
    BookingCancelRequest,
    BookingCreatedEnvelope,
    BookingCreatedResult,
    BookingCreateRequest,
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


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": {"code": code, "message": message}}
    )


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


class ThirdPartyBookingsUseCase:
    async def _log(
        self,
        *,
        endpoint: str,
        claims: ThirdPartyClaims,
        client_ip: str,
        outcome: str,
        location_code: str = "",
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
            result_count=1 if outcome == "granted" else 0,
            created_at=datetime.now(UTC),
        ).insert()

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
    ) -> HTTPException:
        await self._log(
            endpoint=endpoint,
            claims=claims,
            client_ip=client_ip,
            outcome=f"denied_{code}",
            location_code=location_code,
        )
        return _error(status_code, code, message)

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

    async def _load_owned(
        self, *, booking_id: str, endpoint: str, claims: ThirdPartyClaims, client_ip: str
    ) -> ExternalBooking:
        """FR-30/36 — another client's booking is indistinguishable from a missing one."""
        booking = await ExternalBooking.find_one(
            ExternalBooking.booking_id == booking_id,
            ExternalBooking.client_id == claims.client_id,
        )
        if booking is None:
            raise await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_404_NOT_FOUND,
                code="booking_not_found",
                message="Booking not found.",
            )
        return booking

    # --- EXT-008 -------------------------------------------------------------------

    async def create_booking(
        self, *, body: BookingCreateRequest, claims: ThirdPartyClaims, client_ip: str
    ) -> BookingCreatedEnvelope:
        endpoint = ENDPOINT_CREATE
        await self._require_scope(endpoint=endpoint, claims=claims, client_ip=client_ip)

        location_code = _clean(body.location_code)
        cid = _clean(body.cid)
        first_name = _clean(body.first_name)
        last_name = _clean(body.last_name)
        phone = normalize_phone(_clean(body.phone))

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

        missing = [
            name
            for name, value in (
                ("location_code", location_code),
                ("cid", cid),
                ("first_name", first_name),
                ("last_name", last_name),
                ("phone", phone),
            )
            if not value
        ]
        if missing:
            raise await invalid(f"Required fields missing or blank: {', '.join(missing)}.")
        if not _CID_RE.match(cid) or not is_valid_thai_national_id(cid):
            raise await invalid("cid must be 13 digits with a valid checksum.")
        if not _PHONE_RE.match(phone):
            raise await invalid("phone must be a 9–10 digit Thai number.")

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

        cid_hash = national_id_hash(cid)

        async def duplicate() -> HTTPException:
            return await self._deny(
                endpoint=endpoint,
                claims=claims,
                client_ip=client_ip,
                status_code=status.HTTP_409_CONFLICT,
                code="duplicate_booking",
                message="This person already holds a booking at this location.",
                location_code=location_code,
            )

        # FR-17 — duplicates are checked per shelter only (D5).
        held = await PublicPerson.find_one(
            {
                "national_id_hash": cid_hash,
                "shelter_code": location_code,
                "status": {"$in": list(HOLD_STATUSES)},
            }
        )
        buffered = await ExternalBooking.find_one(
            {
                "shelter_code": location_code,
                "cid_hash": cid_hash,
                "state": {"$in": list(OPEN_BOOKING_STATES)},
            }
        )
        if held is not None or buffered is not None:
            raise await duplicate()

        now = datetime.now(UTC)
        booking_id = f"BK-{new_ulid()}"
        try:
            await ExternalBooking(
                id=booking_id,
                booking_id=booking_id,
                client_id=claims.client_id,
                module_name=claims.module_name,
                shelter_code=location_code,
                cid=cid,
                cid_hash=cid_hash,
                first_name=first_name,
                last_name=last_name,
                phone=phone,
                state="pending",
                created_at=now,
                updated_at=now,
            ).insert()
        except DuplicateKeyError:
            # Race guard: the unique partial index on (shelter_code, cid_hash).
            raise await duplicate() from None

        await self._log(
            endpoint=endpoint,
            claims=claims,
            client_ip=client_ip,
            outcome="granted",
            location_code=location_code,
        )
        return BookingCreatedEnvelope(
            result=BookingCreatedResult(booking_id=booking_id, location_code=location_code)
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

        booking = await self._load_owned(
            booking_id=booking_id, endpoint=endpoint, claims=claims, client_ip=client_ip
        )
        collection = ExternalBooking.get_pymongo_collection()
        now = datetime.now(UTC)

        if booking.state == "pending":
            # FR-31 — guarded on state so a concurrent worker write is not overwritten.
            result = await collection.update_one(
                {"_id": booking.id, "state": "pending"},
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
            if result.modified_count == 1:
                return await self._cancelled(endpoint, claims, client_ip, booking)
            # The worker moved it on meanwhile — re-evaluate against the fresh row.
            refreshed = await ExternalBooking.get(booking.id)
            if refreshed is None:
                raise await self._not_cancellable(endpoint, claims, client_ip, booking)
            booking = refreshed

        if booking.state == "written" and not booking.cancel_requested:
            # FR-32 — a missing projection means the worker's write has not synced yet,
            # so the stay is still `pre_registered`.
            person = await PublicPerson.get(booking.evacuee_id) if booking.evacuee_id else None
            if person is None or person.status == "pre_registered":
                result = await collection.update_one(
                    {"_id": booking.id, "state": "written", "cancel_requested": False},
                    {
                        "$set": {
                            "cancel_requested": True,
                            "cancel_reason": reason,
                            "updated_at": now,
                        }
                    },
                )
                if result.modified_count == 1:
                    return await self._cancelled(endpoint, claims, client_ip, booking)

        # FR-33 — cancelled / rejected / already requested / stay moved past pre_registered.
        raise await self._not_cancellable(endpoint, claims, client_ip, booking)

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
        booking = await self._load_owned(
            booking_id=booking_id, endpoint=endpoint, claims=claims, client_ip=client_ip
        )
        booking_status = _booking_status(booking)
        await self._log(
            endpoint=endpoint,
            claims=claims,
            client_ip=client_ip,
            outcome="granted",
            location_code=booking.shelter_code,
        )
        return BookingStatusEnvelope(
            result=BookingStatusResult(
                booking_id=booking.booking_id,
                location_code=booking.shelter_code,
                booking_status=booking_status,
                reject_reason=booking.reject_reason,
                created_at=_to_bangkok_iso(booking.created_at),
                updated_at=_to_bangkok_iso(booking.updated_at),
            )
        )


def get_thirdparty_bookings_use_case() -> ThirdPartyBookingsUseCase:
    return ThirdPartyBookingsUseCase()
