"""Reversible encryption for partner client secrets.

Storage-at-rest only — the `/external/token` verify path still uses
`client_secret_hash` (SHA-256, unchanged) and never decrypts anything. This module
exists solely so a `system_admin` who lost the plaintext can view it again from the
API Keys screen, gated behind re-entering their own CouchDB password (BFF
`POST /api/v1/thirdparty-clients/{id}/secret`). See
draft-partner-client-secret-reveal-edit-delete.

Fernet is AES-128-CBC + HMAC-SHA256 with a random 128-bit IV per encryption
(authenticated, and the IV serves as the "salt" the feature asked for) — not a
simple encode/obfuscation.
"""

from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from ..core.config import settings


class SecretEncryptionError(RuntimeError):
    """The encryption key is missing/invalid, or a stored token can't be decrypted."""


@lru_cache
def _fernet() -> Fernet:
    key = settings.THIRDPARTY_SECRET_ENCRYPTION_KEY
    if not key:
        raise SecretEncryptionError("THIRDPARTY_SECRET_ENCRYPTION_KEY is not set")
    try:
        return Fernet(key.encode())
    except ValueError as exc:
        raise SecretEncryptionError(
            "THIRDPARTY_SECRET_ENCRYPTION_KEY must be a 32-byte urlsafe-base64 key "
            '(generate with `python -c "from cryptography.fernet import Fernet; '
            'print(Fernet.generate_key().decode())"`)'
        ) from exc


def encrypt_secret(plaintext: str) -> str:
    """Encrypt `plaintext` for storage. Raises `SecretEncryptionError` if unconfigured."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    """Decrypt a stored token. Raises `SecretEncryptionError` if it can't be decrypted."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise SecretEncryptionError("Stored secret could not be decrypted") from exc
