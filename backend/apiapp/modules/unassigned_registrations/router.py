"""Unassigned Registration API — public create + staff search/claim/purge (CR-113 / #255)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)

from ...core.security import verify_external_secret
from ...core.staff_session import (
    StaffSession,
    require_registration_staff,
    require_shelter_scoped_staff,
    require_system_admin,
)
from ...infrastructure.gridfs import store_unassigned_photo
from ...utils.request_meta import client_ip
from .couch_birth import CouchBirthPort, get_couch_birth
from .schemas import (
    UnassignedPhotoUploadResponse,
    UnassignedRegistrationClaimRequest,
    UnassignedRegistrationClaimResponse,
    UnassignedRegistrationCreateRequest,
    UnassignedRegistrationCreateResponse,
    UnassignedRegistrationDetailResponse,
    UnassignedRegistrationListResponse,
    UnassignedRegistrationSearchResponse,
    UnassignedRegistrationStatsResponse,
    UnassignedResidenceMatchRequest,
    UnassignedResidenceMatchResponse,
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
_MAX_PHOTO_BYTES = 5 * 1024 * 1024


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
    "/photos",
    response_model=UnassignedPhotoUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_external_secret)],
)
async def upload_unassigned_photo(
    request: Request,
    response: Response,
    full: UploadFile = File(...),  # noqa: B008
    thumb: UploadFile | None = File(default=None),  # noqa: B008
    filename: str = Form(default="face.webp"),
    content_type: str = Form(default="image/webp"),
    width: int | None = Form(default=None),
    height: int | None = Form(default=None),
    original_size: int | None = Form(default=None),
    compressed_size: int | None = Form(default=None),
    thumbnail_size: int | None = Form(default=None),
) -> UnassignedPhotoUploadResponse:
    """Store a compressed face/pet photo in Mongo GridFS for later claim → Couch image (#255)."""
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"

    full_bytes = await full.read(_MAX_PHOTO_BYTES + 1)
    if not full_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "EMPTY_PHOTO"},
        )
    if len(full_bytes) > _MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"error": "PHOTO_TOO_LARGE"},
        )

    thumb_bytes: bytes | None = None
    if thumb is not None:
        thumb_bytes = await thumb.read(_MAX_PHOTO_BYTES + 1)
        if len(thumb_bytes) > _MAX_PHOTO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={"error": "PHOTO_TOO_LARGE"},
            )

    mime = (content_type or full.content_type or "image/webp").strip() or "image/webp"
    stored = await store_unassigned_photo(
        full_bytes=full_bytes,
        thumb_bytes=thumb_bytes,
        filename=(filename or full.filename or "face.webp").strip() or "face.webp",
        content_type=mime,
        width=width,
        height=height,
        original_size=original_size,
        compressed_size=compressed_size,
        thumbnail_size=thumbnail_size,
    )
    return UnassignedPhotoUploadResponse(
        photo_id=stored.photo_id,
        content_type=stored.content_type,
        filename=stored.filename,
        width=stored.width,
        height=stored.height,
        original_size=stored.original_size,
        compressed_size=stored.compressed_size,
        thumbnail_size=stored.thumbnail_size,
    )


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


@router.post(
    "/residence-match",
    response_model=UnassignedResidenceMatchResponse,
    dependencies=[Depends(verify_external_secret)],
)
async def match_unassigned_residence(
    request: Request,
    response: Response,
    payload: UnassignedResidenceMatchRequest,
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
) -> UnassignedResidenceMatchResponse:
    """Service-to-service Residence match — ids + landmark/housing_type only (no member PII)."""
    _enforce_rate_limit(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.match_by_residence(payload)


@staff_router.get(
    "/search",
    response_model=UnassignedRegistrationSearchResponse,
)
async def search_unassigned_registrations(
    response: Response,
    q: str = Query(default="", description="Name, phone, or person id of an open member"),
    _session: StaffSession = Depends(require_shelter_scoped_staff),  # noqa: B008
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
) -> UnassignedRegistrationSearchResponse:
    """Staff online search of open Unassigned Registrations (FR-UR-02 / #245 / #251).

    Auth is shelter-scoped staff or SA (matches BFF) so Station 1 can federate
    anti-dupe for non-claim roles; claim remains ``require_registration_staff``.
    """
    response.headers["Cache-Control"] = "no-store"
    return await use_case.search(q)


@staff_router.get(
    "/stats",
    response_model=UnassignedRegistrationStatsResponse,
)
async def unassigned_registration_stats(
    response: Response,
    _session: StaffSession = Depends(require_system_admin),  # noqa: B008
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
) -> UnassignedRegistrationStatsResponse:
    """SA-only open-queue counts for system overview KPIs."""
    response.headers["Cache-Control"] = "no-store"
    return await use_case.stats()


@staff_router.get(
    "",
    response_model=UnassignedRegistrationListResponse,
)
async def list_unassigned_registrations(
    response: Response,
    q: str = Query(default=""),
    province: str | None = Query(default=None),
    district: str | None = Query(default=None),
    subdistrict: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _session: StaffSession = Depends(require_system_admin),  # noqa: B008
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
) -> UnassignedRegistrationListResponse:
    """SA-only paginated open Unassigned Registrations (system overview PII)."""
    response.headers["Cache-Control"] = "no-store"
    return await use_case.list_open(
        q=q,
        province=province,
        district=district,
        subdistrict=subdistrict,
        limit=limit,
        offset=offset,
    )


@staff_router.get(
    "/{registration_id}",
    response_model=UnassignedRegistrationDetailResponse,
)
async def get_unassigned_registration(
    registration_id: str,
    response: Response,
    _session: StaffSession = Depends(require_system_admin),  # noqa: B008
    use_case: UnassignedRegistrationsUseCase = Depends(  # noqa: B008
        get_unassigned_registrations_use_case
    ),
) -> UnassignedRegistrationDetailResponse:
    """SA-only Unassigned Registration detail (read-only profile)."""
    response.headers["Cache-Control"] = "no-store"
    return await use_case.get_detail(registration_id)


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
