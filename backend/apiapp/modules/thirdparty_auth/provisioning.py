"""Third-party client id/secret generation — used by the admin create endpoint (EXT-001)."""

from __future__ import annotations

import secrets

_CLIENT_ID_PREFIX = "tpc_"
_CLIENT_ID_BYTES = 16
_SECRET_PREFIX = "tps_"
_SECRET_BYTES = 32


def generate_client_id() -> str:
    return f"{_CLIENT_ID_PREFIX}{secrets.token_urlsafe(_CLIENT_ID_BYTES)}"


def generate_client_secret() -> str:
    return f"{_SECRET_PREFIX}{secrets.token_urlsafe(_SECRET_BYTES)}"
