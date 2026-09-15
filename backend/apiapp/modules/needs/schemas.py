"""Needs public list API schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class NeedItemResponse(BaseModel):
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
    #: Catalog category of the item (``food``/``water``/``bedding``/…). The projection
    #: has carried it since the start, but this response dropped it — so the donate
    #: wizard had nothing to pre-fill the item's category from and defaulted every
    #: booking to "food", filing blankets as food (schema.md §2.3 ``items[].category``).
    category: str | None = None


class ShelterNeedsResponse(BaseModel):
    code: str
    name: str
    needs: list[NeedItemResponse]


class NeedsListResponse(BaseModel):
    shelters: list[ShelterNeedsResponse]
    as_of: datetime
