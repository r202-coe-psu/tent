"""EXT-008–010 — partner booking create / cancel / status (M2, CR-154 C3/C4).

Not scope-gated at the router level — the `booking-write` scope is checked inside the
use case so a denied attempt can still be logged (same as EXT-007/011)."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Request, status

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
)
async def create_booking(
    request: Request,
    body: BookingCreateRequest,
    claims: ThirdPartyClaims = Depends(verify_thirdparty_token),  # noqa: B008
    use_case: ThirdPartyBookingsUseCase = Depends(get_thirdparty_bookings_use_case),  # noqa: B008
) -> BookingCreatedEnvelope:
    return await use_case.create_booking(body=body, claims=claims, client_ip=client_ip(request))


@router.post(
    "/bookings/{booking_id}/cancel",
    response_model=BookingCancelledEnvelope,
    responses=_ERRORS,
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
