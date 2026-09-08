"""Schemas for EXT-006 partner cross-location summary (partner ODT Data Dictionary)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class CriticalItem(BaseModel):
    name_th: str
    quantity_on_hand: float
    unit_label: str
    level: str  # "low" | "critical" — "normal" is never sent (ODT note)


class SummaryLocationItem(BaseModel):
    location_code: str
    name_th: str
    location_status: str
    latitude: float | None
    longitude: float | None
    capacity: int
    occupancy_total: int
    critical_items: list[CriticalItem]
    updated_at: datetime


class SummaryResult(BaseModel):
    generated_at: datetime
    location_count: int
    occupancy_total: int | None = None
    capacity_total: int
    locations: list[SummaryLocationItem]


class SummaryEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: SummaryResult
