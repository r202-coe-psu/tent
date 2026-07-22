"""Donations public API router."""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ...core.security import verify_external_secret
from ...utils.request_meta import client_ip
from .schemas import (
    DonationCourierPatchRequest,
    DonationCourierPatchResponse,
    DonationCreateRequest,
    DonationCreateResponse,
    DonationTrackingResponse,
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
