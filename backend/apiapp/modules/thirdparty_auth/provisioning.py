"""Third-party client secret generation — used by the admin create endpoint (EXT-001)."""

from __future__ import annotations

import secrets

_SECRET_PREFIX = "tps_"
_SECRET_BYTES = 32


def generate_client_secret() -> str:
    return f"{_SECRET_PREFIX}{secrets.token_urlsafe(_SECRET_BYTES)}"
