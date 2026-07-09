"""Shelter public list API schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field
from tent_model.public_shelter import GeoPoint


class ShelterItem(BaseModel):
    code: str = Field(description="Shelter code, e.g. SH001")
    name: str
    status: str
    capacity: int = 0
    geo: GeoPoint | None = None
    province: str | None = None
    district: str | None = None
    subdistrict: str | None = None
    updated_at: datetime


class ShelterListResponse(BaseModel):
    shelters: list[ShelterItem]
    count: int
    as_of: datetime
