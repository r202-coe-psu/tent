"""Unit tests for the deterministic client-secret derivation helper."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from apiapp.core.config import Settings
from apiapp.utils import secret_derivation


def test_derive_secret_is_deterministic(settings: Settings) -> None:
    issued_at = datetime.now(UTC)
    a = secret_derivation.derive_secret("tpc_example", issued_at)
    b = secret_derivation.derive_secret("tpc_example", issued_at)
    assert a == b
    assert a.startswith("tps_")


def test_derive_secret_changes_with_issued_at(settings: Settings) -> None:
    issued_at = datetime.now(UTC)
    a = secret_derivation.derive_secret("tpc_example", issued_at)
    b = secret_derivation.derive_secret("tpc_example", issued_at + timedelta(microseconds=1))
    assert a != b


def test_derive_secret_changes_with_client_id(settings: Settings) -> None:
    issued_at = datetime.now(UTC)
    a = secret_derivation.derive_secret("tpc_one", issued_at)
    b = secret_derivation.derive_secret("tpc_two", issued_at)
    assert a != b


def test_new_issued_at_matches_mongo_round_trip_shape() -> None:
    """Naive + millisecond precision — matches how PyMongo decodes a stored BSON
    datetime. Otherwise a secret derived at issue time would stop matching once
    `secret_issued_at` round-trips through the DB (tzinfo dropped, precision truncated)."""
    issued_at = secret_derivation.new_issued_at()
    assert issued_at.tzinfo is None
    assert issued_at.microsecond % 1000 == 0


def test_missing_salt_raises(settings: Settings) -> None:
    original = settings.THIRDPARTY_SECRET_SALT
    settings.THIRDPARTY_SECRET_SALT = ""
    try:
        with pytest.raises(secret_derivation.SecretDerivationError):
            secret_derivation.derive_secret("tpc_example", datetime.now(UTC))
    finally:
        settings.THIRDPARTY_SECRET_SALT = original
