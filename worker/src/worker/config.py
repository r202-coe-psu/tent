"""Worker configuration from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit


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
    audit_diff_enabled: bool = False
    public_writer_name: str = "public_writer"
    # Cap on concurrent CouchDB ``_changes`` feeds (one long-lived connection per listened
    # shelter). Kept above the shelter count so feeds never starve ``CouchClient``'s request
    # pool, but finite so a leaking feed fails loudly instead of eating the host's sockets.
    couch_feed_max_connections: int = 500

    @property
    def couch_base_url(self) -> str:
        return self.couchdb_url.rstrip("/")


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _public_writer_name() -> str:
    explicit = os.environ.get("COUCHDB_PUBLIC_WRITER_NAME", "").strip()
    if explicit:
        return explicit
    url = os.environ.get("COUCHDB_PUBLIC_WRITER_URL", "").strip()
    if url:
        username = urlsplit(url).username
        if username:
            return unquote(username)
    return os.environ.get("COUCHDB_PUBLIC_WRITER_USER", "").strip() or "public_writer"


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
        audit_diff_enabled=_env_flag("AUDIT_DIFF_ENABLED"),
        public_writer_name=_public_writer_name(),
        couch_feed_max_connections=int(
            os.environ.get("COUCH_FEED_MAX_CONNECTIONS", "500")
        ),
    )
