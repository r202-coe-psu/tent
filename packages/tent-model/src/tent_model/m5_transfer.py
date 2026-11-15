"""M5 patient-referral transfers sent by this system (draft CR — referral M5 integration).

FastAPI owns this collection: it upserts a row when TRF-002 succeeds and refreshes the
snapshot on every sync. The worker applies a row to the CouchDB `referral` docs in
`central_ops` whenever ``rev > applied_rev``.

Several writers touch the same row (FastAPI processes and the worker), so never call
``save()`` / ``replace()`` on it: use field-level ``$set`` and an atomic ``$inc`` on
``rev`` (worker: compare-and-set on ``applied_rev``).

No full national ID is ever stored here — only ``national_id_masked`` as M5 returns it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel

M5_OPEN_STATUSES = ("awaiting_review", "pending", "in_transit")
M5_STATUSES = (*M5_OPEN_STATUSES, "rejected", "arrived", "cancelled")


class M5TransferPatient(BaseModel):
    """One patient row, matched to its referral by position in the TRF-002 request."""

    referral_id: str
    acuity: str
    national_id_masked: str = ""


class M5Transfer(Document):
    model_config = ConfigDict(populate_by_name=True)

    # `_id` = external_ref (`TENT-{shelter_code}-{batch_id}`), the M5 idempotency key.
    id: str = Field(alias="_id")
    batch_id: str
    shelter_code: str
    referral_ids: list[str]
    code: str
    status: str
    destination: dict[str, Any] | None = None
    original_destination: dict[str, Any] | None = None
    review: dict[str, Any] | None = None
    activity: list[dict[str, Any]] = Field(default_factory=list)
    patients: list[M5TransferPatient] = Field(default_factory=list)
    # Bumped by FastAPI whenever the M5 snapshot changes; the worker applies rows with
    # `rev > applied_rev` and then compare-and-sets `applied_rev`.
    rev: int = 1
    applied_rev: int = 0
    fetched_at: datetime
    created_at: datetime
    updated_at: datetime

    class Settings:
        name = "m5_transfers"
        indexes = [
            IndexModel([("code", 1)], unique=True),
            IndexModel([("status", 1)]),
            IndexModel([("batch_id", 1)]),
        ]
