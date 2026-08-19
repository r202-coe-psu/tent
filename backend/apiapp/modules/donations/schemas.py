"""Donations public API schemas."""

from __future__ import annotations

from typing import Any

from pydantic import AliasChoices, BaseModel, Field


class DonorInput(BaseModel):
    name: str
    phone: str
    line_id: str | None = None
    email: str | None = None


class DonationItemInput(BaseModel):
    item_id: str | None = None
    category: str | None = None
    free_text: str | None = None
    qty: str | float | int
    unit: str | None = None
    condition: str | None = None
    note: str | None = None


class DonationCreateRequest(BaseModel):
    shelter_code: str
    campaign_id: str | None = None
    #: ``config:app.donation_reservation_ttl_hours`` (schema.md §3.2), read from CouchDB
    #: by the BFF and passed through — this service has no CouchDB client of its own.
    #: Absent means "caller did not resolve it", which falls back to the spec default.
    reservation_ttl_hours: int | None = Field(default=None, gt=0)
    donor: DonorInput
    items: list[DonationItemInput] = Field(default_factory=list)
    logistics: dict[str, Any] | None = None
    captchaToken: str | None = Field(default=None, validation_alias=AliasChoices("captchaToken"))


class DonationCreateResponse(BaseModel):
    success: bool = True
    tracking_token: str
    booking_ref: str


class DonationTrackingResponse(BaseModel):
    success: bool = True
    donation: dict[str, Any]


class DonationCourierPatchRequest(BaseModel):
    courier_tracking_no: str


class DonationCourierPatchResponse(BaseModel):
    success: bool = True
    message: str = "Courier tracking number updated"


class DonationTrackSearchRequest(BaseModel):
    """CR-052 §2.6 — human booking_ref + phone exact match (not token alone)."""

    booking_ref: str
    phone: str


class DonationTrackSearchResponse(BaseModel):
    success: bool = True
    tracking_token: str
    booking_ref: str
