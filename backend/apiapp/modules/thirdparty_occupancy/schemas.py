"""Schemas for EXT-005 partner occupancy endpoint (partner ODT Data Dictionary)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class OccupancyBreakdownItem(BaseModel):
    male: int
    female: int
    child_under_5: int
    elderly_over_60: int
    pregnant: int
    bedridden: int
    disabled: int


class LocationOccupancyResult(BaseModel):
    location_code: str
    capacity: int
    occupancy_total: int
    breakdown: OccupancyBreakdownItem
    updated_at: datetime
    updated_by_role: str


class LocationOccupancyEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: LocationOccupancyResult


class OccupancyErrorDetail(BaseModel):
    code: str
    message: str


class OccupancyErrorResponse(BaseModel):
    error: OccupancyErrorDetail
