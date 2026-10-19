"""Timestamps on public donations copied from Mongo into CouchDB."""

from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.inbound.donations import _persist_donation
from worker.masking import sha256_hex
from worker.timeutil import iso_utc


def test_iso_utc_reads_a_naive_datetime_as_utc():
    # What PyMongo returns without tz_aware: UTC, but no offset attached.
    naive = datetime(2026, 9, 25, 21, 20, 18, 908000)
    assert iso_utc(naive) == "2026-09-25T21:20:18.908Z"


def test_iso_utc_converts_an_aware_datetime_to_utc():
    bangkok = timezone(timedelta(hours=7))
    assert (
        iso_utc(datetime(2026, 9, 26, 4, 20, 18, tzinfo=bangkok))
        == "2026-09-25T21:20:18.000Z"
    )
    assert (
        iso_utc(datetime(2026, 9, 25, 21, 20, 18, tzinfo=UTC))
        == "2026-09-25T21:20:18.000Z"
    )


def _buffer(*, phone: str = "0812345678") -> SimpleNamespace:
    return SimpleNamespace(
        id="donation:01TESTDONATION0000000001",
        shelter_code="SH001",
        campaign_id=None,
        created_at=datetime(2026, 9, 25, 21, 20, 18, 908000),
        expires_at=datetime(2026, 9, 28, 21, 20, 18, 908000),
        booking_ref="DN-123456",
        tracking_token_hash="hash",
        donor=SimpleNamespace(name="ทดสอบ", phone=phone, line_id=None, email=None),
        items_declared=[],
        logistics=None,
        status="pending_review",
        revisions=[],
        synced_to_couch=False,
        save=AsyncMock(),
    )


async def _persisted_doc(donation: SimpleNamespace) -> dict:
    couch = MagicMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.put_doc = AsyncMock(return_value={"ok": True})

    assert await _persist_donation(couch, donation) is True  # type: ignore[arg-type]
    return couch.put_doc.await_args.args[1]


@pytest.mark.asyncio
async def test_persisted_donation_timestamps_carry_z_when_mongo_returns_naive():
    doc = await _persisted_doc(_buffer())
    assert doc["created_at"] == "2026-09-25T21:20:18.908Z"
    assert doc["declared_at"] == "2026-09-25T21:20:18.908Z"
    assert doc["expires_at"] == "2026-09-28T21:20:18.908Z"
    assert doc["updated_at"].endswith("Z")


@pytest.mark.asyncio
@pytest.mark.parametrize("phone", ["0812345678", "081-234-5678", "+66812345678"])
async def test_phone_hash_is_of_the_normalized_number(phone: str):
    """CR-173 FR-13 — every way of writing one number hashes alike, as the backend does."""
    doc = await _persisted_doc(_buffer(phone=phone))
    assert doc["donor"]["phone_hash"] == sha256_hex("0812345678")
    # The number itself is copied as typed; only the hash is normalized.
    assert doc["donor"]["phone"] == phone
