"""Schemas for EXT-002/003 partner Location Master endpoints.

Field names and the response envelope follow the partner ODT
(B_Data_We_Request_From_Partner_Systems) Data Dictionary for EXT-002/EXT-003 verbatim.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from tent_model.public_shelter import (
    DonationPoint,
    ParkingPoint,
    ProfileLuggagePolicy,
    ProfilePetPolicy,
    ProfileRisk,
    ProfileToilets,
)


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
    # #751 - the normal booking rule (EXT-008); same value for every partner token.
    accepts_booking: bool
    accepts_delivery: bool
    delivery_note: str | None
    opened_at: datetime | None
    closed_at: datetime | None
    is_active: bool
    # CR-252 (EXT-002/003): run in another system; `location_status` is `unknown`.
    is_external: bool = False
    occupancy_total: int
    # decision sync 2026-11-24 — additive keys (partner API doc v1.1).
    site_kind: str = Field(
        description="master_data:site_kind code, e.g. evacuation_center, host_house, test_center"
    )
    project_level: str | None = Field(default=None, description="community | lao | provincial")
    occupancy_forecast: int | None = Field(
        default=None,
        description=(
            "Forecast head-count (pre_registered, kiosk_registered, arriving, active, "
            "room_confirmed, temporary_leave); null until the row is re-projected"
        ),
    )
    capacity_available: int | None = Field(
        default=None,
        description="max(0, capacity - occupancy_forecast); null for external shelters",
    )
    parking_vehicle_types: list[str] = Field(
        default_factory=list, description="motorcycle | car | truck | boat"
    )
    updated_at: datetime


class LocationZone(BaseModel):
    code: str | None = None
    name: str | None = None
    type: str
    capacity: int | None = None
    status: Literal["active", "closed"] = "active"
    present: int | None = Field(
        default=None,
        description="Present head-count in the zone; null until the row is re-projected",
    )


class LocationDetailItem(LocationItem):
    facilities: list[str]
    # decision sync 2026-11-24 — detail-only additive keys. null / [] until the row is
    # re-projected by the worker (PROJECTION_VERSION 24).
    external_url: str | None = None
    parking_points: list[ParkingPoint] = Field(default_factory=list)
    donation_points: list[DonationPoint] = Field(default_factory=list)
    area_m2: float | None = None
    area_type: str | None = None
    power_source: str | None = None
    water_source: str | None = None
    communications: list[str] = Field(default_factory=list)
    vhf_channel: str | None = None
    central_kitchen: bool | None = None
    helipad: bool | None = None
    logistics_area_m2: float | None = None
    toilets: ProfileToilets | None = None
    showers: int | None = None
    risk: ProfileRisk | None = None
    vulnerable_groups: list[str] = Field(
        default_factory=list,
        description="The shelter's stored supported vulnerable groups, as entered (no inference)",
    )
    pet_policy: ProfilePetPolicy | None = None
    luggage_policy: ProfileLuggagePolicy | None = None
    zones: list[LocationZone] = Field(default_factory=list)


class PaginationMeta(BaseModel):
    page: int
    limit: int
    total: int
    total_pages: int


class LocationListEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: list[LocationItem]
    pagination: PaginationMeta | None = None


class LocationDetailEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: LocationDetailItem


class LocationErrorDetail(BaseModel):
    code: str
    message: str


class LocationErrorResponse(BaseModel):
    error: LocationErrorDetail
