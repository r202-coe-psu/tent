"""Keyed external mirrors of anonymous public reads (CR-062)."""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from tent_model.public_announcement import PublicAnnouncement

from ...core.security import verify_api_key
from ...utils.request_meta import client_ip
from ..announcements.router import PaginatedAnnouncements
from ..config.schemas import ConfigResponse
from ..config.use_case import ConfigUseCase, get_config_use_case
from ..evacuee.router import _check_rate_limit
from ..evacuee.schemas import ApiErrorResponse, SearchRequest, SearchResponse
from ..evacuee.use_case import EvacueeUseCase, get_evacuee_use_case
from ..needs.schemas import NeedsListResponse
from ..needs.use_case import NeedsUseCase, get_needs_use_case
from ..shelter.schemas import ShelterDetailResponse, ShelterListResponse
from ..shelter.use_case import ShelterUseCase, get_shelter_use_case

router = APIRouter(
    prefix="/external/v1",
    tags=["External"],
    dependencies=[Depends(verify_api_key)],
)

CACHE_CONTROL = "public, max-age=600"
CONFIG_CACHE_CONTROL = "public, max-age=60"


@router.get("/shelters", response_model=ShelterListResponse)
async def list_shelters(
    response: Response,
    province: str | None = Query(default=None),
    district: str | None = Query(default=None),
    subdistrict: str | None = Query(default=None),
    status: str | None = Query(default=None),
    use_case: ShelterUseCase = Depends(get_shelter_use_case),  # noqa: B008
) -> ShelterListResponse:
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await use_case.list_shelters(
        province=province,
        district=district,
        subdistrict=subdistrict,
        status=status,
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
    "/family-search",
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
