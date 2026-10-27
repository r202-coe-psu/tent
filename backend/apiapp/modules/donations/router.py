"""Donations public API router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from ...core.security import verify_external_secret
from ...utils.request_meta import client_ip
from .schemas import (
    DonationCancelResponse,
    DonationCourierPatchRequest,
    DonationCourierPatchResponse,
    DonationCreateRequest,
    DonationCreateResponse,
    DonationItemsPatchRequest,
    DonationItemsPatchResponse,
    DonationPhoneLookupRequest,
    DonationPhoneLookupResponse,
    DonationTrackingResponse,
    DonationTrackSearchRequest,
    DonationTrackSearchResponse,
)
from .use_case import DonationsUseCase, get_donations_use_case

router = APIRouter(prefix="/public/v1/donations", tags=["Donations"])


@router.post(
    "",
    response_model=DonationCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_external_secret)],
)
async def create_donation(
    request: Request,
    response: Response,
    payload: DonationCreateRequest,
    use_case: DonationsUseCase = Depends(get_donations_use_case),  # noqa: B008
) -> DonationCreateResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.create(payload)


@router.post(
    "/track-search",
    response_model=DonationTrackSearchResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def track_search_donation(
    request: Request,
    response: Response,
    payload: DonationTrackSearchRequest,
    use_case: DonationsUseCase = Depends(get_donations_use_case),  # noqa: B008
) -> DonationTrackSearchResponse:
    """Resolve booking_ref (DN-…) + phone → tracking_token (CR-052 §2.6)."""
    response.headers["Cache-Control"] = "no-store"
    return await use_case.track_search(payload.booking_ref, payload.phone)


@router.post(
    "/lookup-by-phone",
    response_model=DonationPhoneLookupResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def lookup_donations_by_phone(
    request: Request,
    response: Response,
    payload: DonationPhoneLookupRequest,
    use_case: DonationsUseCase = Depends(get_donations_use_case),  # noqa: B008
) -> DonationPhoneLookupResponse:
    """Phone number alone → every booking of it still in the buffer (CR-173).

    Full access: each item carries its ``tracking_token``. Guarding against number
    enumeration is the BFF's captcha plus nginx's rate limit (CR-188); this logs every call
    and alerts on volume without refusing any. The BFF sends the donor's IP as ``X-Real-IP``.
    """
    response.headers["Cache-Control"] = "no-store"
    return await use_case.lookup_by_phone(payload.phone, client_ip(request))


@router.get(
    "/{tracking_token}",
    response_model=DonationTrackingResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def get_donation(
    request: Request,
    response: Response,
    tracking_token: str,
    use_case: DonationsUseCase = Depends(get_donations_use_case),  # noqa: B008
) -> DonationTrackingResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.get_by_tracking_token(tracking_token)


@router.patch(
    "/{tracking_token}",
    response_model=DonationCourierPatchResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def patch_donation_courier(
    request: Request,
    response: Response,
    tracking_token: str,
    payload: DonationCourierPatchRequest,
    use_case: DonationsUseCase = Depends(get_donations_use_case),  # noqa: B008
) -> DonationCourierPatchResponse:
    """Update courier tracking on the Mongo intake buffer (pre-inbound only)."""
    response.headers["Cache-Control"] = "no-store"
    return await use_case.update_courier_tracking(tracking_token, payload.courier_tracking_no)


@router.patch(
    "/{tracking_token}/items",
    response_model=DonationItemsPatchResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def patch_donation_items(
    request: Request,
    response: Response,
    tracking_token: str,
    payload: DonationItemsPatchRequest,
    use_case: DonationsUseCase = Depends(get_donations_use_case),  # noqa: B008
) -> DonationItemsPatchResponse:
    """Donor edits their own declared items, moving the quota by the difference (CR-080).

    A separate path from the courier PATCH above: that one touches only the intake
    buffer and can never be refused, while this one moves the atomic counter and answers
    409 when the target is full.
    """
    response.headers["Cache-Control"] = "no-store"
    return await use_case.update_items(
        tracking_token,
        payload.items,
        current_items=payload.current_items,
        current_status=payload.current_status,
    )


@router.delete(
    "/{tracking_token}",
    response_model=DonationCancelResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def cancel_donation(
    request: Request,
    response: Response,
    tracking_token: str,
    use_case: DonationsUseCase = Depends(get_donations_use_case),  # noqa: B008
) -> DonationCancelResponse:
    """Cancel on the Mongo intake buffer (pre-inbound only)."""
    response.headers["Cache-Control"] = "no-store"
    return await use_case.cancel(tracking_token)
