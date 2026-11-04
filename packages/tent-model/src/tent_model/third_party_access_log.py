"""Partner access audit trail — EXT-007, ADR 0002 §6.

Every EXT-007 attempt (granted or denied) is written here: caller, target
location, purpose, source IP, and outcome — required for PDPA auditability
even while the endpoint is scaffolded-but-denied by default.
"""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel

_RETENTION_SECONDS = 365 * 24 * 3600


class ThirdPartyAccessLog(Document):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    client_id: str
    module_name: str | None = None  # None when the client has no module (CR-154 FR-62)
    endpoint: str
    location_code: str
    purpose: str
    ip: str
    # "granted" | "granted_bypass" | "denied_<code>" (incl. denied_missing_purpose,
    # denied_insufficient_scope). `granted_bypass` (#751, CR-182) = EXT-008 created a booking
    # the normal `accepts_booking` rule would refuse, only because the client holds
    # `booking-bypass`. An idempotent replay of such a booking (same Idempotency-Key) creates
    # nothing new and logs plain `granted`.
    status: str
    result_count: int = 0
    created_at: datetime

    class Settings:
        name = "third_party_access_logs"
        indexes = [
            IndexModel([("client_id", 1), ("created_at", 1)]),
            IndexModel([("location_code", 1)]),
            IndexModel([("created_at", 1)], expireAfterSeconds=_RETENTION_SECONDS),
        ]
