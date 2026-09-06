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
    module_name: str
    endpoint: str
    location_code: str
    purpose: str
    ip: str
    status: str  # "granted" | "denied_insufficient_scope" | "denied_missing_purpose"
    result_count: int = 0
    created_at: datetime

    class Settings:
        name = "third_party_access_logs"
        indexes = [
            IndexModel([("client_id", 1), ("created_at", 1)]),
            IndexModel([("location_code", 1)]),
            IndexModel([("created_at", 1)], expireAfterSeconds=_RETENTION_SECONDS),
        ]
