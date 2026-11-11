"""Request/response schemas for `/v1/integrations/*` (draft CR — referral M5 integration §5)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Acuity = Literal["red", "yellow", "green", "black"]
VehicleType = Literal["ambulance", "van", "helicopter", "other"]


class M5Status(BaseModel):
    configured: bool
    token_ok: bool
    reachable: bool
    checked_at: datetime | None = None
    # `not_configured` | `credential_invalid` | `unavailable` | None
    error: str | None = None


class IntegrationStatusResponse(BaseModel):
    """One key per integration so M6 can be added without a breaking change."""

    m5: M5Status


class M5Readiness(BaseModel):
    beds_surge: int
    er_capacity: int
    vital: int
    updated_at: datetime


class M5Facility(BaseModel):
    facility_id: int
    name: str
    category: str
    district: str | None = None
    province: str
    latitude: float | None = None
    longitude: float | None = None
    readiness: M5Readiness | None = None


class M5FacilitiesResponse(BaseModel):
    data: list[M5Facility]
    total: int


class M5OriginIn(BaseModel):
    location_code: str = Field(min_length=1, max_length=64)
    location_name: str = Field(min_length=1, max_length=255)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class M5RequesterIn(BaseModel):
    contact_name: str = Field(min_length=1, max_length=120)
    contact_role: str = Field(min_length=1, max_length=60)
    contact_phone: str = Field(min_length=1, max_length=32)


class M5PatientIn(BaseModel):
    referral_id: str = Field(min_length=1)
    acuity: Acuity
    name: str | None = Field(default=None, max_length=200)
    # Full ID travels in memory only for this call — never persisted (CR §1, D1).
    national_id: str | None = Field(default=None, max_length=32)
    age: int | None = Field(default=None, ge=0, le=150)
    condition: str | None = None


class M5TransferCreateRequest(BaseModel):
    shelter_code: str = Field(min_length=1)
    batch_id: str = Field(min_length=1)
    external_ref: str = Field(min_length=1, max_length=64)
    origin: M5OriginIn
    requester: M5RequesterIn
    destination_facility_id: int
    transport_vehicle_type: VehicleType
    transport_note: str = ""
    note: str = ""
    patients: list[M5PatientIn] = Field(min_length=1)
    actor: str | None = None


class M5TransferCreateResponse(BaseModel):
    code: str
    status: str
    external_ref: str
    replayed: bool


class M5ActionRequest(BaseModel):
    actor: str | None = None


class M5CancelRequest(BaseModel):
    reason: str = Field(min_length=1)
    actor: str | None = None


class M5TransferView(BaseModel):
    """TRF-004 shape as M5 returns it (passed through; extra fields kept)."""

    model_config = ConfigDict(extra="allow")

    code: str
    status: str
    external_ref: str | None = None
    destination: dict[str, Any] | None = None
    original_destination: dict[str, Any] | None = None
    review: dict[str, Any] | None = None
    activity: list[dict[str, Any]] = Field(default_factory=list)


class M5SyncResponse(BaseModel):
    skipped: bool
    checked: int = 0
    changed: int = 0
