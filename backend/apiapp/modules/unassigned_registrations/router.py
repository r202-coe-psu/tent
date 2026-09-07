"""Unassigned Registration API — public create + staff search (CR-113)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from ...core.security import verify_external_secret
from ...core.staff_session import StaffSession, require_registration_staff
from ...utils.request_meta import client_ip
from .schemas import (
    UnassignedRegistrationCreateRequest,
    UnassignedRegistrationCreateResponse,
    UnassignedRegistrationSearchResponse,
)
from .use_case import UnassignedRegistrationsUseCase, get_unassigned_registrations_use_case

router = APIRouter(
    prefix="/public/v1/unassigned-registrations",
    tags=["Unassigned Registrations"],
)

staff_router = APIRouter(
    prefix="/staff/v1/unassigned-registrations",
    tags=["Unassigned Registrations (Staff)"],
)

_RATE_WINDOW_SECONDS = 60
_RATE_MAX_REQUESTS = 30
_rate_buckets: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()


def _enforce_rate_limit(request: Request) -> None:
    """In-process sliding window — not shared across replicas."""
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
    response_model=UnassignedRegistrationCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_external_secret)],
)
async def create_unassigned_registration(
    request: Request,
    response: Response,
    payload: UnassignedRegistrationCreateRequest,
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
) -> UnassignedRegistrationCreateResponse:
    """Public pre-registration without a shelter — writes Mongo only (FR-UR-01)."""
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.create(payload)


@staff_router.get(
    "/search",
    response_model=UnassignedRegistrationSearchResponse,
)
async def search_unassigned_registrations(
    response: Response,
    q: str = Query(default="", description="Name, phone, or person id of an open member"),
    _session: StaffSession = Depends(require_registration_staff),  # noqa: B008
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
) -> UnassignedRegistrationSearchResponse:
    """Staff online search of open Unassigned Registrations (FR-UR-02 / #245)."""
    response.headers["Cache-Control"] = "no-store"
    return await use_case.search(q)
