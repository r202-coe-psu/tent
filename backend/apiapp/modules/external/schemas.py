"""Schemas for external integration (M2 and external consumers)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class M2ShelterItem(BaseModel):
    shelter_id: str = Field(description="รหัสศูนย์พักพิง เช่น SH001")
    shelter_name: str = Field(description="ชื่อศูนย์พักพิง")
    lat: float | None = Field(default=None, description="พิกัดละติจูด (WGS 84)")
    long: float | None = Field(default=None, description="พิกัดลองจิจูด (WGS 84)")


class M2PersonResidencyResponse(BaseModel):
    shelter_id: str = Field(description="รหัสศูนย์พักพิง")
    shelter_name: str = Field(description="ชื่อศูนย์พักพิง")
    checkin_datetime: str = Field(
        description="วันเวลาที่เช็คอิน (ISO 8601 พร้อม timezone เช่น 2026-08-20T14:30:00+07:00)"
    )
    status: Literal["CHECKED_IN", "CHECKED_OUT"] = Field(description="สถานะการเข้าพัก")


class M2ErrorDetail(BaseModel):
    code: str
    message: str


class M2ErrorResponse(BaseModel):
    error: M2ErrorDetail
