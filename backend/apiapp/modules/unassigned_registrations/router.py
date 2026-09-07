"""Unassigned Registration API — public create + staff search/claim/purge (CR-113)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status

from ...core.security import verify_external_secret
from ...core.staff_session import StaffSession, require_registration_staff, require_system_admin
from ...utils.request_meta import client_ip
from .couch_birth import CouchBirthPort, get_couch_birth
from .schemas import (
    UnassignedRegistrationClaimRequest,
    UnassignedRegistrationClaimResponse,
    UnassignedRegistrationCreateRequest,
    UnassignedRegistrationCreateResponse,
    UnassignedRegistrationSearchResponse,
)
from .use_case import UnassignedRegistrationsUseCase

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


def get_unassigned_registrations_use_case(
    couch_birth: Annotated[CouchBirthPort, Depends(get_couch_birth)],
) -> UnassignedRegistrationsUseCase:
    return UnassignedRegistrationsUseCase(couch_birth=couch_birth)


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


@staff_router.post(
    "/{registration_id}/claim",
    response_model=UnassignedRegistrationClaimResponse,
)
async def claim_unassigned_registration(
    registration_id: str,
    payload: UnassignedRegistrationClaimRequest,
    request: Request,
    response: Response,
    session: StaffSession = Depends(require_registration_staff),  # noqa: B008
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
) -> UnassignedRegistrationClaimResponse:
    """Claim open members into this shelter — Couch birth at pre_registered (#247)."""
    response.headers["Cache-Control"] = "no-store"
    cookie_header = cookie or request.headers.get("cookie")
    return await use_case.claim(
        registration_id,
        payload,
        session,
        cookie_header=cookie_header,
    )


@staff_router.delete(
    "/{registration_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_unassigned_registration(
    registration_id: str,
    response: Response,
    _session: StaffSession = Depends(require_system_admin),  # noqa: B008
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
) -> None:
    """system_admin hard-delete of a central-queue document (FR-UR-04 / #246)."""
    response.headers["Cache-Control"] = "no-store"
    await use_case.hard_delete(registration_id)
