"""Shelter public list API schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field
from tent_model.public_shelter import GeoJsonPoint, GeoPoint


class ShelterListCapacityDetail(BaseModel):
    total: int
    available: int


class ShelterItem(BaseModel):
    code: str = Field(description="Shelter code, e.g. SH001")
    name: str
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
    name: str | None = None
    type: str
    capacity: int | None = None
    area_m2: float | None = None


class ShelterDetail(BaseModel):
    id: str
    name: str
    status: str
    admin_type: str
    address: str
    capacity: ShelterCapacityDetail
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


class ShelterDetailResponse(BaseModel):
    shelter: ShelterDetail
