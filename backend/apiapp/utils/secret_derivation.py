"""Deterministic client-secret derivation for partner client secrets.

Storage-at-rest only — the `/external/token` verify path still uses
`client_secret_hash` (SHA-256, unchanged) and never derives anything. This module
exists solely so a `system_admin` who lost the plaintext can view it again from the
API Keys screen, gated behind re-entering their own CouchDB password (BFF
`POST /api/v1/thirdparty-clients/{id}/secret`). See
draft-partner-client-secret-reveal-edit-delete.

Unlike the earlier Fernet-based design, nothing is encrypted or stored as ciphertext:
the secret is `HMAC-SHA256(key=THIRDPARTY_SECRET_SALT, msg=client_id + issued_at)`, so
"revealing" a secret again means recomputing this function from `client_id` +
`secret_issued_at` (both already on the document) — there is no decode/decrypt step.
Regenerating a secret rotates `secret_issued_at`, which changes the derived value
without touching `client_id`. A leaked `THIRDPARTY_SECRET_SALT` lets an attacker derive
every client's secret directly from `client_id` + `secret_issued_at` (both plaintext in
Mongo) — treat it with the same care as the old encryption key.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime

from ..core.config import settings

_SECRET_PREFIX = "tps_"


class SecretDerivationError(RuntimeError):
    """The derivation salt is missing."""


def new_issued_at() -> datetime:
    """Current time normalized to how MongoDB round-trips it: naive (UTC implied),
    millisecond precision.

    PyMongo decodes BSON datetimes as naive UTC and drops sub-millisecond precision, so
    a value derived at issue time from a tz-aware, microsecond-precision
    `datetime.now(UTC)` would stop matching the value re-derived after reading
    `secret_issued_at` back from the DB. Normalizing up front keeps both derivations —
    the one at issue time and every later re-derivation after a fetch — in agreement.
    """
    now = datetime.now(UTC)
    truncated = now.replace(microsecond=(now.microsecond // 1000) * 1000)
    return truncated.replace(tzinfo=None)


def derive_secret(client_id: str, issued_at: datetime) -> str:
    """Derive the client secret for `client_id` as of `issued_at`.

    Deterministic — the same (`client_id`, `issued_at`, salt) always yields the same
    secret. Raises `SecretDerivationError` if `THIRDPARTY_SECRET_SALT` is unconfigured.
    """
    salt = settings.THIRDPARTY_SECRET_SALT
    if not salt:
        raise SecretDerivationError("THIRDPARTY_SECRET_SALT is not set")
    message = f"{client_id}:{issued_at.isoformat()}".encode()
    digest = hmac.new(salt.encode(), message, hashlib.sha256).hexdigest()
    return f"{_SECRET_PREFIX}{digest}"
