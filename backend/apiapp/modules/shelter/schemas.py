"""Shelter public list API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from tent_model.public_shelter import DonationPoint, GeoJsonPoint, GeoPoint, ParkingPoint


class ShelterListCapacityDetail(BaseModel):
    total: int
    available: int


class ShelterItem(BaseModel):
    code: str = Field(description="Shelter code, e.g. SH001")
    name: str
    site_kind: str = Field(
        default="evacuation_center",
        description="Master code from master_data:site_kind (e.g. evacuation_center, host_house)",
    )
    status: str
    capacity: int = 0
    geo: GeoPoint | None = None
    location: GeoJsonPoint | None = None
    province: str | None = None
    district: str | None = None
    subdistrict: str | None = None
    pet_policy: str | None = None
    vulnerable_groups: list[str] | None = None
    admin_type: str | None = None
    accepts_pre_registration: bool = False
    readiness_status: str | None = None
    readiness_tier: str | None = None
    readiness_assessed_at: datetime | None = None
    # CR-253: projected fields only. The list carries them so `/shelters` can draw every pin and
    # filter by vehicle type without a detail call per shelter.
    parking_points: list[ParkingPoint] = Field(default_factory=list)
    parking_vehicle_types: list[str] = Field(default_factory=list)
    updated_at: datetime


class ShelterListResponse(BaseModel):
    shelters: list[ShelterItem]
    count: int
    as_of: datetime


class ShelterCapacityDetail(BaseModel):
    total: int
    available: int


class ShelterAdmissionPolicyDetail(BaseModel):
    pets: str
    vulnerable_groups: list[str]


class ShelterTravelDetail(BaseModel):
    route: str
    altitude: str
    flood_warning: str | None = None


class ShelterHygieneDetail(BaseModel):
    male: int
    female: int
    accessible: int
    shower: int
    mobile_toilet: int


class ShelterFacilitiesDetail(BaseModel):
    hygiene: ShelterHygieneDetail
    power: str
    water: str
    comms: list[str]
    kitchen: str
    parking: str


class ShelterContactDetail(BaseModel):
    manager: str
    phone: str


class ShelterFaqDetail(BaseModel):
    q: str
    a: str


class ShelterZoneDetail(BaseModel):
    code: str | None = None
    name: str | None = None
    type: str
    status: Literal["active", "closed"] = "active"
    capacity: int | None = None
    area_m2: float | None = None
    present: int | None = Field(
        default=None,
        description=(
            "Present headcount in this zone (active + room_confirmed + temporary_leave); "
            "null until the worker has projected per-zone counts (#1241)"
        ),
    )


class ShelterDetail(BaseModel):
    id: str
    name: str
    site_kind: str = Field(
        default="evacuation_center",
        description="Master code from master_data:site_kind (e.g. evacuation_center, host_house)",
    )
    status: str
    admin_type: str
    address: str
    capacity: ShelterCapacityDetail
    # CR-112 occupancy triple: occupancy = Forecast; present / in_zone additive.
    occupancy: int = Field(description="Forecast Occupancy headcount")
    present: int = Field(description="Present Occupancy headcount")
    in_zone: int = Field(description="In-zone Occupancy headcount (room_confirmed)")
    occupancy_rate: int
    building_status: str
    geo: GeoPoint | None = None
    location: GeoJsonPoint | None = None
    admission_policy: ShelterAdmissionPolicyDetail
    travel: ShelterTravelDetail
    facilities: ShelterFacilitiesDetail
    zones: list[ShelterZoneDetail] | None = None
    contact: ShelterContactDetail
    faq: list[ShelterFaqDetail]
    accepts_pre_registration: bool = False
    # CR-205: ticked storage points with a pin, projected by the worker. [] = the shelter's
    # own location is the only drop-off point. Detail only; the list does not carry it.
    donation_points: list[DonationPoint] = Field(default_factory=list)
    # CR-253: projected fields only (never raw_data).
    parking_points: list[ParkingPoint] = Field(default_factory=list)
    parking_vehicle_types: list[str] = Field(default_factory=list)


class ShelterDetailResponse(BaseModel):
    shelter: ShelterDetail


class ExternalShelterZoneDetail(BaseModel):
    """Partner zone shape: without the per-zone `code` / `status` / `present` the public
    detail gained in CR-254 — the partner API stays as it was (CR-254 D3)."""

    name: str | None = None
    type: str
    capacity: int | None = None
    area_m2: float | None = None


class ExternalShelterDetail(ShelterDetail):
    zones: list[ExternalShelterZoneDetail] | None = None


class ExternalShelterDetailResponse(BaseModel):
    shelter: ExternalShelterDetail
