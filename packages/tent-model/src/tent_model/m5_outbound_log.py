"""Audit trail of every call this system makes to M5 (draft CR — referral M5 integration).

PDPA (D1): one row per outbound call with who/when/which transfer and the outcome.
Never stores the request or response payload, names, conditions or national IDs.
"""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class M5OutboundLog(Document):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    # API code from the M5 guide: AUTH-001, TRF-001 … TRF-006.
    endpoint: str
    method: str
    external_ref: str | None = None
    code: str | None = None
    patient_count: int | None = None
    http_status: int | None = None
    # Machine-readable outcome: M5 `code` / `error`, or `timeout` / `network`.
    error: str | None = None
    actor: str | None = None
    duration_ms: int
    at: datetime

    class Settings:
        name = "m5_outbound_logs"
        indexes = [
            IndexModel([("at", 1)]),
            IndexModel([("external_ref", 1)]),
        ]
