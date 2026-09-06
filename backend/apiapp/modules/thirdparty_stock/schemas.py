"""Schemas for EXT-004 partner stock endpoint."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class StockItem(BaseModel):
    m6_reference_id: int | None
    m6_item_code: str | None
    name_th: str
    type_code: str
    unit_label: str
    unit_ratio: float
    quantity_on_hand: float
    source: str


class LocationStockResult(BaseModel):
    location_code: str
    updated_at: datetime
    items: list[StockItem]


class LocationStockEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: LocationStockResult


class StockErrorDetail(BaseModel):
    code: str
    message: str


class StockErrorResponse(BaseModel):
    error: StockErrorDetail
