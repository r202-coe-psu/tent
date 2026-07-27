"""Shelter public list API router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response

from .schemas import ShelterDetailResponse, ShelterListResponse
from .use_case import ShelterUseCase, get_shelter_use_case

router = APIRouter(prefix="/public/v1/shelters", tags=["Shelters"])
CACHE_CONTROL = "public, max-age=600"


@router.get("", response_model=ShelterListResponse)
async def list_shelters(
    response: Response,
    province: str | None = Query(default=None),
    district: str | None = Query(default=None),
    subdistrict: str | None = Query(default=None),
    status: str | None = Query(default=None),
    use_case: ShelterUseCase = Depends(get_shelter_use_case),  # noqa: B008
) -> ShelterListResponse:
    """List shelters from the MongoDB read model."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await use_case.list_shelters(
        province=province,
        district=district,
        subdistrict=subdistrict,
        status=status,
    )


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
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Shelter not found")

    return result
