"""Donations public API router."""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

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
    DonationTrackingResponse,
    DonationTrackSearchRequest,
    DonationTrackSearchResponse,
)
from .use_case import DonationsUseCase, get_donations_use_case

router = APIRouter(prefix="/public/v1/donations", tags=["Donations"])

_RATE_WINDOW_SECONDS = 60
_RATE_MAX_REQUESTS = 30
_rate_buckets: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()


def _enforce_rate_limit(request: Request) -> None:
    """In-process sliding window — not shared across replicas.

    Captcha lives on the SvelteKit BFF. Donation routes also require
    ``EXTERNAL_API_SECRET`` Bearer (service-to-service) so a publicly
    reachable FastAPI cannot bypass captcha. Prefer ``X-Real-IP`` via
    ``client_ip`` when behind nginx.
    """
    ip = client_ip(request)
    now = time.monotonic()
    with _rate_lock:
        bucket = [ts for ts in _rate_buckets[ip] if now - ts < _RATE_WINDOW_SECONDS]
        if len(bucket) >= _RATE_MAX_REQUESTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"error": {"code": "RATE_LIMITED", "message": "Too many requests"}},
            )
        bucket.append(now)
        _rate_buckets[ip] = bucket


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
    _enforce_rate_limit(request)
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
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.track_search(payload.booking_ref, payload.phone)


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
    _enforce_rate_limit(request)
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
    _enforce_rate_limit(request)
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
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.update_items(tracking_token, payload.items)


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
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.cancel(tracking_token)
