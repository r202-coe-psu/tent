"""Third-party client id generation — used by the admin create endpoint (EXT-001).

`client_secret` is no longer generated here — it's derived deterministically by
`utils/secret_derivation.derive_secret()` from `client_id` + `secret_issued_at`.
"""

from __future__ import annotations

import secrets

_CLIENT_ID_PREFIX = "tpc_"
_CLIENT_ID_BYTES = 16


def generate_client_id() -> str:
    return f"{_CLIENT_ID_PREFIX}{secrets.token_urlsafe(_CLIENT_ID_BYTES)}"
