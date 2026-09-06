"""EXT-004 — partner stock read endpoint (partner ODT)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..thirdparty_auth.scopes import require_scope
from .schemas import LocationStockEnvelope, StockErrorResponse
from .use_case import ThirdPartyStockUseCase, get_thirdparty_stock_use_case

router = APIRouter(
    prefix="/api/thirdparty",
    tags=["Third-party Stock"],
    dependencies=[Depends(require_scope("location-stock-read"))],
)


@router.get(
    "/locations/{location_code}/stock",
    response_model=LocationStockEnvelope,
    responses={404: {"model": StockErrorResponse}},
)
async def get_location_stock(
    location_code: str,
    use_case: ThirdPartyStockUseCase = Depends(get_thirdparty_stock_use_case),  # noqa: B008
) -> LocationStockEnvelope:
    return await use_case.get_stock(location_code)
