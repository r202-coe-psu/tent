"""EXT-002/003 — partner Location Master read endpoints (partner ODT)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query

from ..thirdparty_auth.scopes import require_scope
from .schemas import LocationDetailEnvelope, LocationErrorResponse, LocationListEnvelope
from .use_case import ThirdPartyLocationsUseCase, get_thirdparty_locations_use_case

router = APIRouter(
    prefix="/api/thirdparty",
    tags=["Third-party Locations"],
    dependencies=[Depends(require_scope("location-read"))],
)


@router.get("/locations", response_model=LocationListEnvelope)
async def list_locations(
    status: str | None = Query(default=None, description="Filter by location_status"),
    updated_since: datetime | None = Query(default=None),
    include_inactive: bool = Query(
        default=False, description="Include soft-deleted (is_active=false) locations"
    ),
    use_case: ThirdPartyLocationsUseCase = Depends(get_thirdparty_locations_use_case),  # noqa: B008
) -> LocationListEnvelope:
    return await use_case.list_locations(
        status_filter=status, updated_since=updated_since, include_inactive=include_inactive
    )


@router.get(
    "/locations/{location_code}",
    response_model=LocationDetailEnvelope,
    responses={404: {"model": LocationErrorResponse}},
)
async def get_location(
    location_code: str,
    use_case: ThirdPartyLocationsUseCase = Depends(get_thirdparty_locations_use_case),  # noqa: B008
) -> LocationDetailEnvelope:
    return await use_case.get_location(location_code)
