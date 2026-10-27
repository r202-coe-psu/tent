"""Schemas for EXT-012 partner person search (#736)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PersonSearchRequest(BaseModel):
    """Body of `POST /external/persons/search`.

    No length / shape constraint here: the query is validated inside the use case (after the
    purpose and scope checks) so a rejected attempt is still logged and answered with the partner
    `validation_error`, not FastAPI's generic body error.
    """

    search: str = Field(
        default="",
        description="คำค้น: ชื่อ / เลขบัตร 13 หลัก / พาสปอร์ต / เบอร์โทร (ไม่ส่งใน URL)",
    )


class PersonSearchItem(BaseModel):
    """A masked match — same fields as public search minus `family_members` (#736 decision 4)."""

    name: str
    status: str
    national_id: str | None = None
    gender: str | None = None
    shelter_name: str
    shelter_address: str | None = None
    origin_address: str | None = None
    checked_in_at: str | None = Field(
        default=None, description="วันเวลาเข้าพัก ISO 8601 (+07:00); null เมื่อยังไม่ check-in"
    )
    care_zone: str | None = None
    zone_name: str | None = None


class PersonSearchEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: list[PersonSearchItem] = Field(description="สูงสุด 10 รายการ; ว่างเมื่อไม่พบ")


class PersonSearchErrorResponse(BaseModel):
    status: int
    message: str
    code: str | None = None
    detail: str | None = None
