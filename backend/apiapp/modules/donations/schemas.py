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


class DonationItemsPatchRequest(BaseModel):
    #: The whole basket the donor wants, not a delta — dropping a line means leaving it
    #: out. The service works out the difference against what is already reserved.
    items: list[DonationItemInput]


class DonationItemsPatchResponse(BaseModel):
    success: bool = True
    message: str = "Donation items updated"
    #: How many entries the revision log now holds, so a caller can show "แก้ไข N ครั้ง".
    revisions: int = 0
    #: The stored items after the edit, carrying the per-item ``reserved_qty`` the
    #: counter now holds. The BFF writes these straight onto the CouchDB document once
    #: the donation has synced, so the two never have to recompute the same split.
    items: list[dict[str, Any]] = Field(default_factory=list)
    #: The entry just appended, for the BFF to add to the CouchDB document's log.
    revision: dict[str, Any] = Field(default_factory=dict)


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


class DonationCancelResponse(BaseModel):
    success: bool = True
    message: str = "Donation cancelled successfully"
