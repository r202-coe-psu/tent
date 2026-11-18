"""Schemas for EXT-007 partner occupant-detail endpoint (partner ODT Data Dictionary)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class OccupantItem(BaseModel):
    occupant_ref: str
    name_masked: str
    age_range: str
    gender: str | None = None
    care_flags: list[str] = []
    checked_in_at: datetime | None = None


class OccupantFullItem(OccupantItem):
    """Unmasked occupant — only with `occupancy-pii-read` + `pii-full` (CR-257 OD-3).

    A field is `null` when the person has no such data or the row predates PROJECTION_VERSION 23
    (never a masked value). `name_masked` / `age_range` stay for clients that read them.
    """

    first_name: str | None = None
    last_name: str | None = None
    name: str | None = None
    age: int | None = None
    national_id: str | None = None
    passport_id: str | None = None
    id_card_type: str | None = Field(
        default=None, description="national_id | passport | pink_card | other"
    )
    phone: str | None = None


class PaginationMeta(BaseModel):
    page: int
    limit: int
    total: int
    total_pages: int


class OccupantsEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: list[OccupantFullItem | OccupantItem] = []
    pagination: PaginationMeta | None = None


class OccupantsErrorResponse(BaseModel):
    status: int
    message: str
    detail: str | None = None
