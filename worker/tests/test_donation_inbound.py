"""Timestamps on public donations copied from Mongo into CouchDB."""

from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.inbound.donations import _persist_donation
from worker.timeutil import iso_utc


def test_iso_utc_reads_a_naive_datetime_as_utc():
    # What PyMongo returns without tz_aware: UTC, but no offset attached.
    naive = datetime(2026, 9, 25, 21, 20, 18, 908000)  # noqa: DTZ001 — the point of the test
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


@pytest.mark.asyncio
async def test_persisted_donation_timestamps_carry_z_when_mongo_returns_naive():
    donation = SimpleNamespace(
        id="donation:01TESTDONATION0000000001",
        shelter_code="SH001",
        campaign_id=None,
        created_at=datetime(2026, 9, 25, 21, 20, 18, 908000),  # noqa: DTZ001 — naive, as from Mongo
        expires_at=datetime(2026, 9, 28, 21, 20, 18, 908000),  # noqa: DTZ001
        booking_ref="DN-123456",
        tracking_token_hash="hash",
        donor=SimpleNamespace(
            name="ทดสอบ", phone="0812345678", line_id=None, email=None
        ),
        items_declared=[],
        logistics=None,
        status="pending_review",
        revisions=[],
        synced_to_couch=False,
        save=AsyncMock(),
    )
    couch = MagicMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.put_doc = AsyncMock(return_value={"ok": True})

    assert await _persist_donation(couch, donation) is True  # type: ignore[arg-type]
    doc = couch.put_doc.await_args.args[1]
    assert doc["created_at"] == "2026-09-25T21:20:18.908Z"
    assert doc["declared_at"] == "2026-09-25T21:20:18.908Z"
    assert doc["expires_at"] == "2026-09-28T21:20:18.908Z"
    assert doc["updated_at"].endswith("Z")
