"""Needs public list API schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ExternalNeedItemResponse(BaseModel):
    """One row per shelter + item_id: the `/external/v1/needs` shape (CR-206 A2 FR-AP-27)."""

    item_id: str
    name: str
    qty_needed: str
    #: What the shortage is made of, so the donor board can draw a real progress bar
    #: (`qty_needed = qty_target − on_hand − reserved`). Strings for the same reason
    #: `qty_needed` is one: quantities cross the wire without picking up float error.
    qty_target: str = "0"
    on_hand: str = "0"
    reserved: str = "0"
    unit: str
    status: str
    #: Highest urgency across the open campaigns asking for this item, so the donor
    #: board can rank "ด่วน" rows without a second round-trip.
    urgency: str = "normal"
    #: Catalog category of the item (``food``/``water``/``bedding``/…). The projection
    #: has carried it since the start, but this response dropped it — so the donate
    #: wizard had nothing to pre-fill the item's category from and defaulted every
    #: booking to "food", filing blankets as food (schema.md §2.3 ``items[].category``).
    category: str | None = None


class NeedItemResponse(ExternalNeedItemResponse):
    """One donor-board card: shelter + item + drop-off point (CR-206 A2 FR-AP-26).

    Several cards of one shelter may share an ``item_id``.
    """

    #: The drop-off point of the need (``donation_campaign.needs[].drop_off_point_id``);
    #: ``None`` when the need has none.
    drop_off_point_id: str | None = None
    #: Name from ``public_shelters.donation_points``; ``None`` when the id is ``None`` or
    #: no longer one of the shelter's points.
    drop_off_point_name: str | None = None


class ShelterNeedsResponse(BaseModel):
    code: str
    name: str
    needs: list[NeedItemResponse]


class NeedsListResponse(BaseModel):
    shelters: list[ShelterNeedsResponse]
    as_of: datetime


class ExternalShelterNeedsResponse(BaseModel):
    code: str
    name: str
    needs: list[ExternalNeedItemResponse]


class ExternalNeedsListResponse(BaseModel):
    shelters: list[ExternalShelterNeedsResponse]
    as_of: datetime
