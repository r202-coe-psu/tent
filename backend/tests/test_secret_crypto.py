"""Unit tests for the reversible client-secret encryption helper."""

from __future__ import annotations

import pytest

from apiapp.core.config import Settings
from apiapp.utils import secret_crypto


@pytest.fixture(autouse=True)
def _clear_fernet_cache():
    """`_fernet()` is `lru_cache`d process-wide — clear it around each test so the
    `settings` fixture's key (or a test's own override) is actually re-read."""
    secret_crypto._fernet.cache_clear()
    yield
    secret_crypto._fernet.cache_clear()


def test_encrypt_then_decrypt_round_trips(settings: Settings) -> None:
    plaintext = "tps_example-secret-value"
    token = secret_crypto.encrypt_secret(plaintext)
    assert token != plaintext
    assert secret_crypto.decrypt_secret(token) == plaintext


def test_encrypting_the_same_plaintext_twice_gives_different_ciphertext(
    settings: Settings,
) -> None:
    """Fernet's random per-call IV means ciphertext isn't a deterministic hash."""
    a = secret_crypto.encrypt_secret("same-plaintext")
    b = secret_crypto.encrypt_secret("same-plaintext")
    assert a != b


def test_missing_key_raises(settings: Settings) -> None:
    original = settings.THIRDPARTY_SECRET_ENCRYPTION_KEY
    settings.THIRDPARTY_SECRET_ENCRYPTION_KEY = ""
    try:
        with pytest.raises(secret_crypto.SecretEncryptionError):
            secret_crypto.encrypt_secret("anything")
    finally:
        settings.THIRDPARTY_SECRET_ENCRYPTION_KEY = original


def test_malformed_key_raises(settings: Settings) -> None:
    original = settings.THIRDPARTY_SECRET_ENCRYPTION_KEY
    settings.THIRDPARTY_SECRET_ENCRYPTION_KEY = "not-a-valid-fernet-key"
    try:
        with pytest.raises(secret_crypto.SecretEncryptionError):
            secret_crypto.encrypt_secret("anything")
    finally:
        settings.THIRDPARTY_SECRET_ENCRYPTION_KEY = original


def test_tampered_token_fails_to_decrypt(settings: Settings) -> None:
    token = secret_crypto.encrypt_secret("tps_example")
    tampered = token[:-4] + ("A" * 4)
    with pytest.raises(secret_crypto.SecretEncryptionError):
        secret_crypto.decrypt_secret(tampered)
