"""Donations public API schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator


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
    #: CR-196 — which held line this is, as ``GET`` returned it. Ignored on create, where
    #: every line gets a new one. On an edit, a line without one is a new line.
    line_key: str | None = None
    #: CR-206 FR-MP-1 — the drop-off point (``public_shelters.donation_points[].id``) the
    #: donor takes this line to. ``None`` = no point. Only ``self_dropoff`` keeps it
    #: (FR-MP-4). The BFF sets it from the campaign need, never from the donor, and it is
    #: not checked against ``public_shelters`` (FR-AP-10). On an edit a held line keeps its
    #: own point while its ``item_id`` is unchanged (FR-AP-15).
    drop_off_point_id: str | None = None


class SlotHold(BaseModel):
    """The capped queue window a booking takes a place in, as the BFF read it.

    Sent only when the window has a ceiling. ``capacity`` is the window's current
    ceiling and ``booked`` the places CouchDB already shows held — the counter is seeded
    from it on the window's first booking. The BFF is the only caller (service secret),
    so both figures come from CouchDB, not from the donor.
    """

    mode: Literal["dropoff", "pickup"]
    date: str
    from_: str = Field(alias="from")
    capacity: int = Field(gt=0)
    booked: int = Field(ge=0)

    model_config = {"populate_by_name": True}


#: CR-209 FR-1 — the same ceiling as the BFF's zod `VEHICLE_PLATE_MAX`.
VEHICLE_PLATE_MAX = 40


def _checked_vehicle_plate(logistics: dict[str, Any] | None) -> dict[str, Any] | None:
    """CR-209 FR-1d: FR-1 / FR-1a enforced here too, not only in the BFF's zod schema.

    The plate is free text, trimmed; blank after trim leaves no key; at most
    ``VEHICLE_PLATE_MAX`` characters; only a ``self_dropoff`` may carry one.
    """
    if not logistics or "vehicle_plate" not in logistics:
        return logistics
    checked = dict(logistics)
    plate = checked.pop("vehicle_plate")
    if plate is None:
        return checked
    if not isinstance(plate, str):
        raise ValueError("vehicle_plate must be text")
    plate = plate.strip()
    if not plate:
        return checked
    if len(plate) > VEHICLE_PLATE_MAX:
        raise ValueError("ทะเบียนรถยาวเกินไป")
    if checked.get("delivery_method") != "self_dropoff":
        raise ValueError("vehicle_plate is only allowed for self_dropoff")
    checked["vehicle_plate"] = plate
    return checked


class DonationCreateRequest(BaseModel):
    shelter_code: str
    campaign_id: str | None = None
    donor: DonorInput
    items: list[DonationItemInput] = Field(default_factory=list)
    logistics: dict[str, Any] | None = None
    slot_hold: SlotHold | None = None
    #: CR-175 donor photos — ``image:{ulid}`` ids the BFF already checked against the
    #: shelter's CouchDB (FR-10). The worker copies them onto the booking and binds each
    #: photo to it (FR-11a).
    photos: list[str] = Field(default_factory=list, max_length=30)
    captchaToken: str | None = Field(default=None, validation_alias=AliasChoices("captchaToken"))

    @field_validator("logistics")
    @classmethod
    def _vehicle_plate(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _checked_vehicle_plate(value)


class DonationCreateItem(BaseModel):
    """One booked line as stored, so the ticket can group by point without a second read."""

    drop_off_point_id: str | None
    review_status: str


class DonationCreateResponse(BaseModel):
    success: bool = True
    tracking_token: str
    booking_ref: str
    #: The status the booking opened in (CR-174 FR-15): ``verifying`` when every line is
    #: in the campaign and the QR is good at once, else ``pending_review``.
    status: str
    #: One per request line, same order (FR-AP-8a).
    items: list[DonationCreateItem]


class DonationTrackingResponse(BaseModel):
    success: bool = True
    donation: dict[str, Any]


class DonationCourierPatchRequest(BaseModel):
    courier_tracking_no: str


class DonationItemsPatchRequest(BaseModel):
    #: The whole basket the donor wants, not a delta — dropping a line means leaving it
    #: out. The service works out the difference against what is already reserved.
    items: list[DonationItemInput]
    #: The CouchDB document's ``items`` and ``status`` as the BFF read them before the edit.
    #: Staff review lines in CouchDB, which this service cannot read, so these are what
    #: tells it the booking was reviewed (CR-196 FR-LK-4) and which ``line_key``s it holds.
    #: Omitted (e.g. the booking has not reached CouchDB yet) → the service uses its own
    #: copies.
    current_items: list[dict[str, Any]] | None = None
    current_status: str | None = None


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
    #: The booking status after the edit, read off the re-reviewed lines (CR-174 FR-18b).
    #: The BFF writes it onto the CouchDB document with ``items``.
    status: str
    #: Index into ``items`` of every line this edit approved automatically (CR-174 FR-26).
    #: The BFF writes the ``approved_by: system`` audit for exactly these.
    auto_approved_lines: list[int] = Field(default_factory=list)


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


class DonationPhoneLookupRequest(BaseModel):
    """CR-173 FR-1 — the phone travels in the body only, never in the URL."""

    phone: str = Field(min_length=1, max_length=32)


class DonationPhoneLookupSlot(BaseModel):
    date: str | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None

    model_config = {"populate_by_name": True}


class DonationPhoneLookupItem(BaseModel):
    """One booking of the number — enough to tell them apart and open the full ticket."""

    tracking_token: str
    booking_ref: str
    status: str
    shelter_code: str
    shelter_name: str | None = None
    delivery_method: str | None = None
    slot: DonationPhoneLookupSlot | None = None
    item_count: int
    created_at: str


class DonationPhoneLookupResponse(BaseModel):
    """Same shape whether the number has bookings or not (CR-173 FR-5)."""

    success: bool = True
    items: list[DonationPhoneLookupItem] = Field(default_factory=list)


class DonationCancelResponse(BaseModel):
    success: bool = True
    message: str = "Donation cancelled successfully"
