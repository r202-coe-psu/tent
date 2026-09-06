"""Use case for EXT-005 partner occupancy endpoint (partner ODT, ADR 0002 §2)."""

from __future__ import annotations

from fastapi import HTTPException, status
from tent_model.public_shelter import PublicShelter

from .schemas import LocationOccupancyEnvelope, LocationOccupancyResult, OccupancyBreakdownItem

# ODT: "ขอเป็นตำแหน่งงาน ไม่ใช่ชื่อบุคคล" — the aggregation is fully automated by the
# sync worker (no manual staff entry), so this is a fixed value, not a stored field.
_UPDATED_BY_ROLE = "ระบบนับอัตโนมัติ (Sync Worker)"


def _location_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": {"code": code, "message": message}}
    )


class ThirdPartyOccupancyUseCase:
    async def get_occupancy(self, location_code: str) -> LocationOccupancyEnvelope:
        shelter = await PublicShelter.find_one(PublicShelter.shelter_code == location_code)
        if shelter is None:
            raise _location_error(
                status.HTTP_404_NOT_FOUND,
                "location_not_found",
                f"No location with code '{location_code}'",
            )

        breakdown = shelter.occupancy_breakdown
        return LocationOccupancyEnvelope(
            result=LocationOccupancyResult(
                location_code=location_code,
                capacity=shelter.capacity,
                occupancy_total=shelter.occupancy_total,
                breakdown=OccupancyBreakdownItem(
                    male=breakdown.male,
                    female=breakdown.female,
                    child_under_5=breakdown.child_under_5,
                    elderly_over_60=breakdown.elderly_over_60,
                    pregnant=breakdown.pregnant,
                    bedridden=breakdown.bedridden,
                    disabled=breakdown.disabled,
                ),
                updated_at=shelter.updated_at,
                updated_by_role=_UPDATED_BY_ROLE,
            )
        )


def get_thirdparty_occupancy_use_case() -> ThirdPartyOccupancyUseCase:
    return ThirdPartyOccupancyUseCase()
