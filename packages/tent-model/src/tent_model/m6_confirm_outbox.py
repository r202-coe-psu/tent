"""Pending RES-007 confirmations (draft CR — central warehouse M6).

The worker inserts one row when the ``channel: m6`` donation of a withdrawal becomes
``received``; FastAPI's ``/v1/integrations/m6/sync`` sends it to M6 and retries with
backoff until ``done_at`` is set. ``_id`` = ``request_code`` so a row is written once.
"""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel

from tent_model.m6_withdrawal import M6Person


class M6ConfirmOutbox(Document):
    model_config = ConfigDict(populate_by_name=True)

    # `_id` = M6 request_code.
    id: str = Field(alias="_id")
    external_ref: str
    shelter_code: str
    donation_id: str
    received_by: list[M6Person] = Field(default_factory=list)
    note: str
    attempts: int = 0
    last_error: str | None = None
    next_attempt_at: datetime | None = None
    done_at: datetime | None = None
    created_at: datetime

    class Settings:
        name = "m6_confirm_outbox"
        indexes = [
            IndexModel([("done_at", 1), ("next_attempt_at", 1)]),
        ]
