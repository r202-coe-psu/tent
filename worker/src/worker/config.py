"""Worker configuration from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    couchdb_url: str
    couchdb_user: str
    couchdb_password: str
    mongodb_uri: str
    # FastAPI outbound integration plane (draft CR — referral M5 §1). The worker only taps
    # `POST /v1/integrations/m5/sync`; it never holds M5 credentials.
    fastapi_url: str = "http://localhost:9000"
    external_api_secret: str = ""
    m5_sync_interval_s: float = 45.0
    # Same for M6 central warehouse (`/v1/integrations/m6/sync`, draft CR — M6 §1).
    m6_sync_interval_s: float = 45.0

    @property
    def couch_base_url(self) -> str:
        return self.couchdb_url.rstrip("/")


def load_settings() -> Settings:
    couch_url = os.environ.get("COUCHDB_URL", "http://localhost:5984")
    user = os.environ.get("COUCHDB_USER", "admin")
    password = os.environ.get("COUCHDB_PASSWORD", "password")
    mongo = os.environ.get("DATABASE_URI", "mongodb://localhost:27017/tentdb")
    return Settings(
        couchdb_url=couch_url,
        couchdb_user=user,
        couchdb_password=password,
        mongodb_uri=mongo,
        fastapi_url=os.environ.get("FASTAPI_INTERNAL_URL", "http://localhost:9000"),
        external_api_secret=os.environ.get("EXTERNAL_API_SECRET", ""),
        m5_sync_interval_s=float(os.environ.get("M5_SYNC_INTERVAL_S", "45")),
        m6_sync_interval_s=float(os.environ.get("M6_SYNC_INTERVAL_S", "45")),
    )
