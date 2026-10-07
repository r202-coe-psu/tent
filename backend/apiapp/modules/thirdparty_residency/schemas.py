"""Schemas for EXT-011 partner shelter-residency lookup (M2, CR-154)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ResidencyItem(BaseModel):
    location_code: str = Field(description="รหัสศูนย์พักพิง (ตรงกับ EXT-002)")
    name_th: str = Field(description="ชื่อศูนย์พักพิง")
    checkin_datetime: str = Field(description="วันเวลาเข้าพัก ISO 8601 (+07:00)")
    residency_status: Literal["CHECKED_IN", "CHECKED_OUT"]
    stay_status: str = Field(description="สถานะ stay ดิบจาก projection")
    in_zone: bool = Field(description="True เมื่อยืนยันถึงโซนแล้ว (room_confirmed)")


class ResidencyEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: ResidencyItem


class ResidencyErrorResponse(BaseModel):
    status: int
    message: str
    code: str | None = None
    detail: str | None = None
