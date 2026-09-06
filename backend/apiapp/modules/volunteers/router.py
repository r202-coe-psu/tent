"""Public volunteer job board + Digital Pass router (CR-092)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from ...core.security import verify_external_secret
from ...utils.request_meta import client_ip
from .schemas import (
    DispatchRespondRequest,
    DispatchRespondResponse,
    PublicJobListResponse,
    ScheduleLookupRequest,
    TicketFindRequest,
    TicketFindResponse,
    VolunteerApplyRequest,
    VolunteerApplyResponse,
    VolunteerCancelResponse,
    VolunteerProfileResponse,
    VolunteerProfileUpdateRequest,
    VolunteerProfileUpdateResponse,
    VolunteerScheduleResponse,
    VolunteerTicketResponse,
)
from .use_case import VolunteersUseCase, get_volunteers_use_case

router = APIRouter(prefix="/public/v1", tags=["Volunteers"])

_RATE_WINDOW_SECONDS = 60
_RATE_MAX_REQUESTS = 30
_rate_buckets: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()


def _enforce_rate_limit(request: Request) -> None:
    """In-process sliding window — not shared across replicas.

    The tight per-application limit CR-092 asks for (3 / 10 min) lives on the BFF
    alongside reCAPTCHA, where the client IP is real. This is the service-side backstop
    for a FastAPI that is reachable directly, and matches the donations router.
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


@router.get(
    "/jobs",
    response_model=PublicJobListResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def list_jobs(
    request: Request,
    response: Response,
    shelter_code: str | None = Query(default=None),
    skill: str | None = Query(default=None),
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> PublicJobListResponse:
    _enforce_rate_limit(request)
    # Quota moves with every application; a cached board sends people to a full job.
    response.headers["Cache-Control"] = "no-store"
    return await use_case.list_jobs(shelter_code=shelter_code, skill=skill)


@router.post(
    "/jobs/{job_id}/apply",
    response_model=VolunteerApplyResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_external_secret)],
)
async def apply_to_job(
    request: Request,
    response: Response,
    job_id: str,
    payload: VolunteerApplyRequest,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> VolunteerApplyResponse:
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.apply(job_id, payload)


@router.get(
    "/volunteer/ticket/{token}",
    response_model=VolunteerTicketResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def get_ticket(
    request: Request,
    response: Response,
    token: str,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> VolunteerTicketResponse:
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.get_ticket(token)


@router.post(
    "/volunteer/ticket/find",
    response_model=TicketFindResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def find_tickets(
    request: Request,
    response: Response,
    payload: TicketFindRequest,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> TicketFindResponse:
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.find_tickets(
        phone=payload.phone, token=payload.token, portal_id=payload.portal_id
    )


@router.post(
    "/volunteer/ticket/{token}/cancel",
    response_model=VolunteerCancelResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def cancel_ticket(
    request: Request,
    response: Response,
    token: str,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> VolunteerCancelResponse:
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.cancel(token)


@router.post(
    "/volunteer/schedule",
    response_model=VolunteerScheduleResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def volunteer_schedule(
    request: Request,
    response: Response,
    payload: ScheduleLookupRequest,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> VolunteerScheduleResponse:
    """ตารางทำงานจิตอาสา — the roster behind the Access Portal (CR-092 หน้าจอ 6)."""
    _enforce_rate_limit(request)
    # Check-in state changes during a shift; a cached schedule shows someone as not yet
    # arrived after they have scanned in.
    response.headers["Cache-Control"] = "no-store"
    return await use_case.schedule(
        phone=payload.phone, token=payload.token, portal_id=payload.portal_id
    )


@router.post(
    "/volunteer/schedule/respond",
    response_model=DispatchRespondResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def respond_to_dispatch(
    request: Request,
    response: Response,
    payload: DispatchRespondRequest,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> DispatchRespondResponse:
    """Accept or decline an offered shift with the code a manager read out."""
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.respond_to_dispatch(
        assignment_id=payload.assignment_id,
        phone=payload.phone,
        token=payload.token,
        portal_id=payload.portal_id,
        code=payload.code,
        action=payload.action,
    )


@router.post(
    "/volunteer/access/resolve",
    response_model=VolunteerProfileResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def resolve_volunteer_access(
    request: Request,
    response: Response,
    payload: TicketFindRequest,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> VolunteerProfileResponse:
    """Resolve a portal credential before a browser session is created."""
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.profile(
        phone=payload.phone, token=payload.token, portal_id=payload.portal_id
    )


@router.post(
    "/volunteer/profile",
    response_model=VolunteerProfileResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def volunteer_profile(
    request: Request,
    response: Response,
    payload: ScheduleLookupRequest,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> VolunteerProfileResponse:
    """The volunteer's own profile, for the Access Portal's edit screen."""
    _enforce_rate_limit(request)
    # Staff edit the same profile from the back office; a cached copy would show the
    # volunteer a name or a badge the shelter has already changed.
    response.headers["Cache-Control"] = "no-store"
    return await use_case.profile(phone=payload.phone, token=payload.token)


@router.post(
    "/volunteer/profile/update",
    response_model=VolunteerProfileUpdateResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def update_volunteer_profile(
    request: Request,
    response: Response,
    payload: VolunteerProfileUpdateRequest,
    use_case: VolunteersUseCase = Depends(get_volunteers_use_case),  # noqa: B008
) -> VolunteerProfileUpdateResponse:
    """Change the parts of the profile the volunteer owns (skills, for now)."""
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.update_profile(
        skills=payload.skills,
        phone=payload.phone,
        token=payload.token,
        portal_id=payload.portal_id,
    )
