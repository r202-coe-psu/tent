"""Schemas for EXT-002/003 partner Location Master endpoints.

Field names and the response envelope follow the partner ODT
(B_Data_We_Request_From_Partner_Systems) Data Dictionary for EXT-002/EXT-003 verbatim.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class LocationItem(BaseModel):
    location_code: str
    name_th: str
    name_short: str | None
    location_type: str
    location_subtype: str | None
    location_status: str
    latitude: float | None
    longitude: float | None
    address: str | None
    subdistrict_code: str | None
    district_code: str | None
    province_code: str | None
    capacity: int
    contact_phone: str | None
    contact_name: str | None
    operating_org: str | None
    accepts_delivery: bool
    delivery_note: str | None
    opened_at: datetime | None
    closed_at: datetime | None
    is_active: bool
    occupancy_total: int
    updated_at: datetime


class LocationDetailItem(LocationItem):
    facilities: list[str]


class LocationListEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: list[LocationItem]


class LocationDetailEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: LocationDetailItem


class LocationErrorDetail(BaseModel):
    code: str
    message: str


class LocationErrorResponse(BaseModel):
    error: LocationErrorDetail
