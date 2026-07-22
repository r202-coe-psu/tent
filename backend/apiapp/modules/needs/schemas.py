"""Needs public list API schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class NeedItemResponse(BaseModel):
    item_id: str
    name: str
    qty_needed: str
    unit: str
    status: str


class ShelterNeedsResponse(BaseModel):
    code: str
    name: str
    needs: list[NeedItemResponse]


class NeedsListResponse(BaseModel):
    shelters: list[ShelterNeedsResponse]
    as_of: datetime
