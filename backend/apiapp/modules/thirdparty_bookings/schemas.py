"""Schemas for EXT-008–010 partner bookings (M2, CR-154 C3/C4; multi-CID CR-169).

Request fields are deliberately lenient (`str | None`) — the use case validates them so
a rejected attempt is still logged and answered with the partner `validation_error`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

BookingStatus = Literal["BOOKED", "CANCELLED", "REJECTED"]

# CR-169 FR-6 — ceiling of one synchronous all-or-nothing request (checked in the use case).
MAX_PERSONS = 100
# Hard schema-level bound (ABOVE the use-case cap) so an oversized body is rejected at parse
# time. 101..MAX_PERSONS_HARD_LIMIT still reach the use case and get the usual 422 message.
MAX_PERSONS_HARD_LIMIT = 1000


class BookingPersonInput(BaseModel):
    cid: str | None = Field(default=None, description="เลขประจำตัวประชาชน 13 หลัก")
    first_name: str | None = Field(default=None, description="ชื่อ")
    last_name: str | None = Field(default=None, description="นามสกุล")
    phone: str | None = Field(default=None, description="เบอร์โทรศัพท์ (รับ +66)")


class BookingCreateRequest(BaseModel):
    location_code: str | None = Field(default=None, description="รหัสศูนย์พักพิง (EXT-002)")
    persons: list[BookingPersonInput] | None = Field(
        default=None,
        max_length=MAX_PERSONS_HARD_LIMIT,
        description=(
            f"ผู้จองในกลุ่มเดียวกัน 1–{MAX_PERSONS} คน (all-or-nothing) — "
            "ห้ามส่งพร้อม cid/first_name/last_name/phone ระดับบน"
        ),
    )
    cid: str | None = Field(
        default=None, description="รูปแบบเดิม (คนเดียว) — เลขประจำตัวประชาชน 13 หลัก"
    )
    first_name: str | None = Field(default=None, description="รูปแบบเดิม (คนเดียว) — ชื่อ")
    last_name: str | None = Field(default=None, description="รูปแบบเดิม (คนเดียว) — นามสกุล")
    phone: str | None = Field(default=None, description="รูปแบบเดิม (คนเดียว) — เบอร์โทรศัพท์ (รับ +66)")


class BookingCancelRequest(BaseModel):
    reason: str | None = Field(default=None, description="เหตุผลการยกเลิก (≤200 ตัวอักษร)")


class BookingCreatedResult(BaseModel):
    booking_id: str
    location_code: str
    booking_status: BookingStatus = "BOOKED"
    persons_count: int


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


class BookingPersonStatus(BaseModel):
    index: int = Field(description="ลำดับใน persons[] ตอนจอง (เริ่ม 0)")
    booking_status: BookingStatus
    reject_reason: str | None = None


class BookingStatusResult(BaseModel):
    booking_id: str
    location_code: str
    booking_status: BookingStatus = Field(
        description=(
            "สรุปทั้งกลุ่ม: ไม่มีคนที่ยังเปิดอยู่ (OPEN) และมีอย่างน้อย 1 คนที่ "
            "CANCELLED หรือ cancel_requested → CANCELLED, มีคน REJECTED → REJECTED, "
            "อื่น ๆ → BOOKED"
        )
    )
    reject_reason: str | None = Field(default=None, description="เหตุผลของคนแรกที่ REJECTED (ถ้ามี)")
    persons: list[BookingPersonStatus]
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
