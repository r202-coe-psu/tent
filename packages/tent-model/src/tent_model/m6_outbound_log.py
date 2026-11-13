"""Audit trail of every call this system makes to M6 (draft CR — central warehouse M6).

One row per outbound call with who/when/which request and the outcome. Never stores the
request or response payload.
"""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class M6OutboundLog(Document):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    # API code from the M6 guide: AUTH-001, AUTH-002, RES-001 … RES-008.
    endpoint: str
    method: str
    external_ref: str | None = None
    request_code: str | None = None
    line_count: int | None = None
    http_status: int | None = None
    # Machine-readable outcome: M6 `detail` / `error` / `code`, or `timeout` / `network`.
    error: str | None = None
    actor: str | None = None
    duration_ms: int
    at: datetime

    class Settings:
        name = "m6_outbound_logs"
        indexes = [
            IndexModel([("at", 1)]),
            IndexModel([("request_code", 1)]),
        ]
