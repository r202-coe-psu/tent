"""EXT-008–010 — partner booking create / cancel / status (M2, CR-154 C3/C4).

Not scope-gated at the router level — the `booking-write` scope is checked inside the
use case so a denied attempt can still be logged (same as EXT-007/011)."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Header, Request, status

from ...utils.request_meta import client_ip
from ..thirdparty_auth.scopes import ThirdPartyClaims, verify_thirdparty_token
from .schemas import (
    BookingCancelledEnvelope,
    BookingCancelRequest,
    BookingCreatedEnvelope,
    BookingCreateRequest,
    BookingErrorResponse,
    BookingStatusEnvelope,
)
from .use_case import ThirdPartyBookingsUseCase, get_thirdparty_bookings_use_case

router = APIRouter(prefix="/external", tags=["External"])

_ERRORS = {code: {"model": BookingErrorResponse} for code in (401, 403, 404, 409, 422)}


@router.post(
    "/bookings",
    status_code=status.HTTP_201_CREATED,
    response_model=BookingCreatedEnvelope,
    responses=_ERRORS,
    description=(
        "Books one or more persons (`persons[]`, or the legacy single `cid` body) as one group. "
        "Optional `Idempotency-Key` header (1–255 characters, kept 24 hours per client): a retry "
        "with the same key and body returns the original 201 body (same `booking_id`); the same "
        "key with a different body returns 409 `idempotency_key_reused`; a retry while the first "
        "request is still running returns 409 `idempotency_in_progress`. A key whose first "
        "attempt failed without creating a booking is released, so a retry can proceed."
    ),
)
async def create_booking(
    request: Request,
    body: BookingCreateRequest,
    claims: ThirdPartyClaims = Depends(verify_thirdparty_token),  # noqa: B008
    use_case: ThirdPartyBookingsUseCase = Depends(get_thirdparty_bookings_use_case),  # noqa: B008
    idempotency_key: str | None = Header(  # noqa: B008
        default=None,
        alias="Idempotency-Key",
        description="Optional retry key for this client (1–255 characters, valid 24 hours).",
    ),
) -> BookingCreatedEnvelope:
    return await use_case.create_booking(
        body=body,
        claims=claims,
        client_ip=client_ip(request),
        idempotency_key=idempotency_key,
    )


@router.post(
    "/bookings/{booking_id}/cancel",
    response_model=BookingCancelledEnvelope,
    responses=_ERRORS,
    description=(
        "Cancels the whole booking group. Only OPEN persons (pending, or written without a "
        "cancel request) are cancelled; finished persons (cancelled, rejected, or already "
        "cancel-requested) are skipped and left unchanged. Repeating a cancel that has already "
        "happened returns 200. Returns 409 `booking_not_cancellable` when every person is "
        "rejected, or when an open person can no longer be cancelled (e.g. checked in); in the "
        "latter case no person is changed."
    ),
)
async def cancel_booking(
    request: Request,
    booking_id: str,
    body: BookingCancelRequest | None = Body(default=None),  # noqa: B008
    claims: ThirdPartyClaims = Depends(verify_thirdparty_token),  # noqa: B008
    use_case: ThirdPartyBookingsUseCase = Depends(get_thirdparty_bookings_use_case),  # noqa: B008
) -> BookingCancelledEnvelope:
    return await use_case.cancel_booking(
        booking_id=booking_id, body=body, claims=claims, client_ip=client_ip(request)
    )


@router.get(
    "/bookings/{booking_id}",
    response_model=BookingStatusEnvelope,
    responses=_ERRORS,
)
async def get_booking(
    request: Request,
    booking_id: str,
    claims: ThirdPartyClaims = Depends(verify_thirdparty_token),  # noqa: B008
    use_case: ThirdPartyBookingsUseCase = Depends(get_thirdparty_bookings_use_case),  # noqa: B008
) -> BookingStatusEnvelope:
    return await use_case.get_booking(
        booking_id=booking_id, claims=claims, client_ip=client_ip(request)
    )
