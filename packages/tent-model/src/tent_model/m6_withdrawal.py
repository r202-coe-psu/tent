"""M6 central-warehouse withdrawals sent by this system (draft CR — central warehouse M6).

FastAPI owns this collection: it inserts a row when RES-005 succeeds and refreshes the
snapshot from RES-006 on every sync. The worker applies a row whenever
``rev > applied_rev``: it creates the shelter donation (``channel: m6``) once the
withdrawal is ``in_transit`` and copies the RES-007 confirmation result onto it.

Several writers touch the same row (FastAPI processes and the worker), so never call
``save()`` / ``replace()`` on it: use field-level ``$set`` and an atomic ``$inc`` on
``rev`` (worker: compare-and-set on ``applied_rev``).

RES-006 returns only ``item_code``, ``qty`` and ``qty_fulfilled`` per line, so ``name``,
``unit`` and ``type_code`` are kept from the RES-005 request and never overwritten.
"""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel

M6_OPEN_STATUSES = ("pending", "approved", "partially_approved", "in_transit")
M6_STATUSES = (*M6_OPEN_STATUSES, "issued", "received", "rejected", "cancelled")


class M6WithdrawalLine(BaseModel):
    item_code: str
    name: str
    unit: str
    type_code: str | None = None
    qty: int
    # Set by M6 once the request is approved / dispatched; null before that.
    qty_fulfilled: int | None = None


class M6Person(BaseModel):
    name: str
    username: str | None = None


class M6Withdrawal(Document):
    model_config = ConfigDict(populate_by_name=True)

    # `_id` = external_ref (`TENT-{shelter_code}-{ulid}`), the M6 idempotency key.
    id: str = Field(alias="_id")
    shelter_code: str
    request_code: str
    status: str
    source_warehouse_code: str
    source_warehouse_name: str | None = None
    lines: list[M6WithdrawalLine] = Field(default_factory=list)
    reason: str
    requested_by: M6Person
    contact_role: str | None = None
    contact_phone: str | None = None
    # Timestamps as M6 reports them (RES-006).
    submitted_at: datetime | None = None
    approved_at: datetime | None = None
    completed_at: datetime | None = None
    # Set by RES-008 through this system.
    cancelled_at: datetime | None = None
    cancelled_by: M6Person | None = None
    cancel_reason: str | None = None
    # `donation:m6-{request_code}` once the worker created it (D1, D5).
    donation_id: str | None = None
    # RES-007 outcome, copied onto the donation's `external` by the worker.
    confirmed_at: datetime | None = None
    confirm_error: str | None = None
    rev: int = 1
    applied_rev: int = 0
    fetched_at: datetime
    created_at: datetime
    updated_at: datetime

    class Settings:
        name = "m6_withdrawals"
        indexes = [
            IndexModel([("request_code", 1)], unique=True),
            IndexModel([("shelter_code", 1), ("created_at", -1)]),
            IndexModel([("status", 1)]),
        ]
