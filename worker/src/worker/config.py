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

    @property
    def couch_base_url(self) -> str:
        return self.couchdb_url.rstrip("/")


def load_settings() -> Settings:
    couch_url = os.environ.get("COUCHDB_URL", "http://localhost:5984")
    user = os.environ.get("COUCHDB_USER", "admin")
    password = os.environ.get("COUCHDB_PASSWORD", "password")
    mongo = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/tentdb")
    return Settings(
        couchdb_url=couch_url,
        couchdb_user=user,
        couchdb_password=password,
        mongodb_uri=mongo,
    )
