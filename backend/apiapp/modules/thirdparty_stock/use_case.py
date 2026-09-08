"""Use case for EXT-004 partner stock endpoint (partner ODT, ADR 0002 §5)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from tent_model.public_shelter import PublicShelter
from tent_model.shelter_stock import ShelterStock

from .schemas import LocationStockEnvelope, LocationStockResult, StockItem


def _location_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": {"code": code, "message": message}}
    )


def _to_item(doc: ShelterStock) -> StockItem:
    return StockItem(
        m6_reference_id=doc.m6_reference_id,
        m6_item_code=doc.m6_item_code,
        name_th=doc.name_th,
        type_code=doc.type_code,
        unit_label=doc.unit_label,
        unit_ratio=doc.unit_ratio,
        quantity_on_hand=doc.quantity_on_hand,
        source=doc.source,
    )


class ThirdPartyStockUseCase:
    async def get_stock(self, location_code: str) -> LocationStockEnvelope:
        shelter = await PublicShelter.find_one(PublicShelter.shelter_code == location_code)
        if shelter is None:
            raise _location_error(
                status.HTTP_404_NOT_FOUND,
                "location_not_found",
                f"No location with code '{location_code}'",
            )

        rows = (
            await ShelterStock.find(ShelterStock.shelter_code == location_code)
            .sort("+item_id")
            .to_list()
        )
        items = [_to_item(row) for row in rows]
        updated_at = (
            max((row.updated_at for row in rows), default=None)
            or shelter.updated_at
            or datetime.now(UTC)
        )
        return LocationStockEnvelope(
            result=LocationStockResult(
                location_code=location_code, updated_at=updated_at, items=items
            )
        )


def get_thirdparty_stock_use_case() -> ThirdPartyStockUseCase:
    return ThirdPartyStockUseCase()
