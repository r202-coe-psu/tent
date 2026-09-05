from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class GeoPoint(BaseModel):
    lat: float
    lng: float


class GeoJsonPoint(BaseModel):
    type: str = "Point"
    coordinates: list[float]  # [longitude, latitude]


class OccupancyBreakdown(BaseModel):
    """Demographic/Special Needs headcount — EXT-005, ADR 0002 §2."""

    male: int = 0
    female: int = 0
    child_under_5: int = 0
    elderly_over_60: int = 0
    pregnant: int = 0
    bedridden: int = 0
    disabled: int = 0


class PublicShelter(Document):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    shelter_code: str
    registry_id: str | None = None
    name: str
    name_short: str | None = None
    site_kind: str = "evacuation_center"
    status: str = "open"
    location_status: str = "open"
    is_active: bool = True
    location_type: str = "shelter"
    location_subtype: str | None = None
    location: GeoJsonPoint | None = None
    geo: GeoPoint | None = None
    capacity: int = 0
    province: str | None = None
    district: str | None = None
    subdistrict: str | None = None
    address: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    operating_org: str | None = None
    accepts_delivery: bool = True
    delivery_note: str | None = None
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    occupancy_total: int = 0
    occupancy_breakdown: OccupancyBreakdown = Field(default_factory=OccupancyBreakdown)
    raw_data: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime

    class Settings:
        name = "public_shelters"
        indexes = [
            IndexModel([("location", "2dsphere")]),
            IndexModel([("shelter_code", 1)]),
            IndexModel([("registry_id", 1)]),
            IndexModel([("province", 1), ("district", 1), ("subdistrict", 1)]),
            IndexModel([("site_kind", 1)]),
            IndexModel([("status", 1)]),
            IndexModel([("location_status", 1)]),
            IndexModel([("is_active", 1)]),
        ]
