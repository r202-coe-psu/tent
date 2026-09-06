"""Schemas for EXT-007 partner occupant-detail endpoint (partner ODT Data Dictionary)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class OccupantItem(BaseModel):
    occupant_ref: str
    name_masked: str
    age_range: str
    gender: str | None = None
    care_flags: list[str] = []
    checked_in_at: datetime | None = None


class OccupantsEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: list[OccupantItem] = []


class OccupantsErrorResponse(BaseModel):
    status: int
    message: str
    detail: str | None = None
