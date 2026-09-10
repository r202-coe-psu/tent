"""Keyed external integration endpoints (CR-062, M2 Integration)."""

from __future__ import annotations

import math
from datetime import UTC
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from tent_model.public_announcement import PublicAnnouncement
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter

from ...core.security import verify_api_key
from ...utils.masking import national_id_hash
from ...utils.request_meta import client_ip
from ..announcements.router import PaginatedAnnouncements
from ..config.schemas import ConfigResponse
from ..config.use_case import ConfigUseCase, get_config_use_case
from ..evacuee.router import _check_rate_limit
from ..evacuee.schemas import ApiErrorResponse, SearchRequest, SearchResponse
from ..evacuee.use_case import EvacueeUseCase, get_evacuee_use_case
from ..needs.schemas import NeedsListResponse
from ..needs.use_case import NeedsUseCase, get_needs_use_case
from ..shelter.schemas import ShelterDetailResponse
from ..shelter.use_case import ShelterUseCase, get_shelter_use_case
from .residency import map_shelter_residency
from .schemas import M2ErrorResponse, M2PersonResidencyResponse, M2ShelterItem

router = APIRouter(
    prefix="/external/v1",
    tags=["External"],
    dependencies=[Depends(verify_api_key)],
)

CACHE_CONTROL = "public, max-age=600"
CONFIG_CACHE_CONTROL = "public, max-age=60"
BANGKOK_TZ = ZoneInfo("Asia/Bangkok")


@router.get(
    "/shelters",
    response_model=list[M2ShelterItem],
    summary="ดึงรายการศูนย์พักพิง (get-list-shelter)",
    responses={
        401: {"model": M2ErrorResponse},
        403: {"model": M2ErrorResponse},
        500: {"model": M2ErrorResponse},
    },
)
async def list_shelters(
    response: Response,
    status: str | None = Query(default=None, description="กรองสถานะ เช่น open"),
) -> list[M2ShelterItem]:
    """ดึงรายการศูนย์พักพิงสำหรับระบบภายนอก (M2)."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    query: dict[str, object] = {}
    if status:
        query["status"] = status

    docs = await PublicShelter.find(query).sort("+name").to_list()
    return [
        M2ShelterItem(
            shelter_id=doc.shelter_code,
            shelter_name=doc.name,
            site_kind=doc.site_kind,
            lat=doc.geo.lat if doc.geo else None,
            long=doc.geo.lng if doc.geo else None,
        )
        for doc in docs
    ]


@router.get(
    "/persons/shelter-residency",
    response_model=M2PersonResidencyResponse,
    summary="ตรวจสอบสถานะการเข้าพัก (get-person-shelter-residency)",
    responses={
        401: {"model": M2ErrorResponse},
        403: {"model": M2ErrorResponse},
        404: {"model": M2ErrorResponse},
        422: {"model": M2ErrorResponse},
        500: {"model": M2ErrorResponse},
    },
)
async def get_person_shelter_residency(
    response: Response,
    cid: str = Query(..., description="เลขประจำตัวประชาชน 13 หลัก"),
) -> M2PersonResidencyResponse:
    """ตรวจสอบสถานะการเข้าพักศูนย์พักพิงของผู้ประสบภัยจากเลขประจำตัวประชาชน (CID)."""
    response.headers["Cache-Control"] = "no-store"
    cleaned_cid = cid.strip()
    if not cleaned_cid.isdigit() or len(cleaned_cid) != 13:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": {"code": "validation_error", "message": "CID ต้องเป็นตัวเลข 13 หลัก"}},
        )

    cid_hash = national_id_hash(cleaned_cid)
    person = await PublicPerson.find_one(PublicPerson.national_id_hash == cid_hash)

    if person is None or person.checked_in_at is None or person.status == "pre_registered":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "not_found", "message": "ไม่พบประวัติการเข้าพักของ CID นี้"}},
        )

    residency_status, stay_status, in_zone = map_shelter_residency(person.status)

    shelter = await PublicShelter.find_one({"shelter_code": person.shelter_code})
    shelter_name = shelter.name if shelter else person.shelter_code

    checkin_dt = person.checked_in_at
    if checkin_dt.tzinfo is None:
        checkin_dt = checkin_dt.replace(tzinfo=UTC)
    bangkok_dt = checkin_dt.astimezone(BANGKOK_TZ)
    iso_datetime = bangkok_dt.isoformat()

    return M2PersonResidencyResponse(
        shelter_id=person.shelter_code,
        shelter_name=shelter_name,
        checkin_datetime=iso_datetime,
        status=residency_status,
        stay_status=stay_status,
        in_zone=in_zone,
    )


@router.get("/shelters/{code}", response_model=ShelterDetailResponse)
async def get_shelter(
    code: str,
    response: Response,
    use_case: ShelterUseCase = Depends(get_shelter_use_case),  # noqa: B008
) -> ShelterDetailResponse:
    response.headers["Cache-Control"] = CACHE_CONTROL
    result = await use_case.get_shelter(code=code)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "NOT_FOUND", "message": "Shelter not found"}},
        )
    return result


@router.get("/needs", response_model=NeedsListResponse)
async def list_needs(
    response: Response,
    use_case: NeedsUseCase = Depends(get_needs_use_case),  # noqa: B008
) -> NeedsListResponse:
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await use_case.list_needs()


@router.post(
    "/occupants",
    response_model=SearchResponse,
    responses={
        429: {"model": ApiErrorResponse},
        422: {"model": ApiErrorResponse},
    },
)
async def search_evacuees(
    payload: SearchRequest,
    request: Request,
    response: Response,
    use_case: EvacueeUseCase = Depends(get_evacuee_use_case),  # noqa: B008
) -> SearchResponse:
    ip = client_ip(request)
    _check_rate_limit(ip)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.search(payload.search, client_ip=ip)


@router.get("/announcements", response_model=PaginatedAnnouncements)
async def get_active_announcements(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> PaginatedAnnouncements:
    query = PublicAnnouncement.find(PublicAnnouncement.is_active == True)  # noqa: E712
    total = await query.count()
    total_pages = math.ceil(total / size) if total > 0 else 0
    announcements = await query.sort("-updated_at").skip((page - 1) * size).limit(size).to_list()
    return PaginatedAnnouncements(
        items=announcements, total=total, page=page, size=size, total_pages=total_pages
    )


@router.get("/config/faqs", response_model=ConfigResponse)
async def get_faqs(
    response: Response,
    use_case: ConfigUseCase = Depends(get_config_use_case),  # noqa: B008
) -> ConfigResponse:
    response.headers["Cache-Control"] = CONFIG_CACHE_CONTROL
    return await use_case.get_public_faqs()
