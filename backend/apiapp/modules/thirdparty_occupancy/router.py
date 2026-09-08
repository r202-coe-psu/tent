"""EXT-005 — partner occupancy read endpoint (partner ODT)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..thirdparty_auth.scopes import require_scope
from .schemas import LocationOccupancyEnvelope, OccupancyErrorResponse
from .use_case import ThirdPartyOccupancyUseCase, get_thirdparty_occupancy_use_case

router = APIRouter(
    prefix="/api/thirdparty",
    tags=["Third-party Occupancy"],
    dependencies=[Depends(require_scope("occupancy-read"))],
)


@router.get(
    "/locations/{location_code}/occupancy",
    response_model=LocationOccupancyEnvelope,
    responses={404: {"model": OccupancyErrorResponse}},
)
async def get_location_occupancy(
    location_code: str,
    use_case: ThirdPartyOccupancyUseCase = Depends(get_thirdparty_occupancy_use_case),  # noqa: B008
) -> LocationOccupancyEnvelope:
    return await use_case.get_occupancy(location_code)
