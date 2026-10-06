"""Schemas for EXT-008–010 partner bookings (M2, CR-154 C3/C4).

Request fields are deliberately lenient (`str | None`) — the use case validates them so
a rejected attempt is still logged and answered with the partner `validation_error`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

BookingStatus = Literal["BOOKED", "CANCELLED", "REJECTED"]


class BookingCreateRequest(BaseModel):
    location_code: str | None = Field(default=None, description="รหัสศูนย์พักพิง (EXT-002)")
    cid: str | None = Field(default=None, description="เลขประจำตัวประชาชน 13 หลัก")
    first_name: str | None = Field(default=None, description="ชื่อ")
    last_name: str | None = Field(default=None, description="นามสกุล")
    phone: str | None = Field(default=None, description="เบอร์โทรศัพท์ (รับ +66)")


class BookingCancelRequest(BaseModel):
    reason: str | None = Field(default=None, description="เหตุผลการยกเลิก (≤200 ตัวอักษร)")


class BookingCreatedResult(BaseModel):
    booking_id: str
    location_code: str
    booking_status: BookingStatus = "BOOKED"


class BookingCreatedEnvelope(BaseModel):
    status: int = 201
    message: str = "Booking accepted."
    result: BookingCreatedResult


class BookingCancelledResult(BaseModel):
    booking_id: str
    booking_status: BookingStatus = "CANCELLED"


class BookingCancelledEnvelope(BaseModel):
    status: int = 200
    message: str = "Booking cancelled."
    result: BookingCancelledResult


class BookingStatusResult(BaseModel):
    booking_id: str
    location_code: str
    booking_status: BookingStatus
    reject_reason: str | None = None
    created_at: str = Field(description="ISO 8601 (+07:00)")
    updated_at: str = Field(description="ISO 8601 (+07:00)")


class BookingStatusEnvelope(BaseModel):
    status: int = 200
    message: str = "Found Data."
    result: BookingStatusResult


class BookingErrorResponse(BaseModel):
    status: int
    message: str
    code: str | None = None
    detail: str | None = None
