"""Shelter public list API router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from ...core.security import verify_external_secret
from .schemas import ShelterDetailResponse, ShelterListResponse, ShelterSummaryResponse
from .use_case import ShelterUseCase, get_shelter_use_case

router = APIRouter(
    prefix="/public/v1/shelters",
    tags=["Shelters"],
    dependencies=[Depends(verify_external_secret)],
)
CACHE_CONTROL = "public, max-age=600"


@router.get("", response_model=ShelterListResponse)
async def list_shelters(
    response: Response,
    province: str | None = Query(default=None),
    district: str | None = Query(default=None),
    subdistrict: str | None = Query(default=None),
    status: str | None = Query(default=None),
    site_kind: str | None = Query(default=None),
    lat: float | None = Query(default=None, ge=-90.0, le=90.0, description="User latitude"),
    lng: float | None = Query(default=None, ge=-180.0, le=180.0, description="User longitude"),
    radius_km: float | None = Query(default=None, gt=0, description="Search radius in kilometers"),
    q: str | None = Query(
        default=None,
        description="Case-insensitive text in the name, code, province or district",
    ),
    admin_type: str | None = Query(
        default=None, description="Shelter (building) type code, e.g. school, temple"
    ),
    hide_full: bool = Query(default=False, description="Leave out shelters that are full"),
    hide_evacuation: bool = Query(
        default=False, description="Leave out non-external evacuation centres"
    ),
    hide_external: bool = Query(default=False, description="Leave out external shelters"),
    hide_host_house: bool = Query(
        default=False, description="Leave out host houses that are not external"
    ),
    parking: list[str] | None = Query(
        default=None, description="Vehicle types the shelter must take (all of them)"
    ),
    use_case: ShelterUseCase = Depends(get_shelter_use_case),  # noqa: B008
) -> ShelterListResponse:
    """List shelters from the MongoDB read model."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await use_case.list_shelters(
        province=province,
        district=district,
        subdistrict=subdistrict,
        status=status,
        site_kind=site_kind,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        q=q,
        admin_type=admin_type,
        hide_full=hide_full,
        hide_evacuation=hide_evacuation,
        hide_external=hide_external,
        hide_host_house=hide_host_house,
        parking=parking,
    )


# Declared before `/{code}` so "summary" is not read as a shelter code.
@router.get("/summary", response_model=ShelterSummaryResponse)
async def shelter_summary(
    response: Response,
    hide_host_house: bool = Query(
        default=False, description="Leave out host houses that are not external"
    ),
    use_case: ShelterUseCase = Depends(get_shelter_use_case),  # noqa: B008
) -> ShelterSummaryResponse:
    """Shelter head counts for the public search cards, independent of the list filters."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await use_case.summary(hide_host_house=hide_host_house)


@router.get("/{code}", response_model=ShelterDetailResponse)
async def get_shelter(
    code: str,
    response: Response,
    use_case: ShelterUseCase = Depends(get_shelter_use_case),  # noqa: B008
) -> ShelterDetailResponse:
    """Get shelter detail from the MongoDB read model."""
    response.headers["Cache-Control"] = CACHE_CONTROL

    result = await use_case.get_shelter(code=code)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "NOT_FOUND", "message": "Shelter not found"}},
        )

    return result
