"""Tests for retention helpers."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from tent_model import DonationBuffer, DonationNeedCounter, DonorBuffer

from worker.projectors.compute_needs import compute_needs
from worker.retention.job import (
    classify_expired_buffer,
    purge_expired_buffers,
    run_retention_once,
)


def test_compute_needs_zero_when_fully_covered():
    campaigns = [
        {
            "_id": "donation_campaign:01",
            "needs": [{"item_id": "item:rice", "qty_target": "5"}],
        }
    ]
    donations = [
        {
            "campaign_id": "donation_campaign:01",
            "status": "declared",
            "items": [{"item_id": "item:rice", "qty": "5"}],
        }
    ]
    remaining, _ = compute_needs(campaigns, donations)
    assert remaining["item:rice"] == "0.0"


def test_classify_expired_buffer_skips_unsynced():
    now = datetime.now(UTC)
    expired = now - timedelta(hours=1)
    assert (
        classify_expired_buffer(synced_to_couch=False, expires_at=expired, now=now) == "stuck"
    )
    assert (
        classify_expired_buffer(synced_to_couch=True, expires_at=expired, now=now) == "purge"
    )
    assert (
        classify_expired_buffer(
            synced_to_couch=True, expires_at=now + timedelta(hours=1), now=now
        )
        == "keep"
    )
    assert classify_expired_buffer(synced_to_couch=False, expires_at=None, now=now) == "keep"


async def test_purge_releases_quota_for_timed_out_declared_buffer(db: None) -> None:
    now = datetime.now(UTC)
    counter_id = "SH001:donation_campaign:c1:item:rice"
    await DonationNeedCounter(
        id=counter_id,
        shelter_code="SH001",
        campaign_id="donation_campaign:c1",
        item_id="item:rice",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("4"),
        created_at=now,
        updated_at=now,
    ).insert()
    await DonationBuffer(
        id="donation:01TESTEXPIRED0000000001",
        shelter_code="SH001",
        donor=DonorBuffer(name="Timeout Donor", phone="0810000001"),
        items_declared=[
            {"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 4, "unit": "kg", "reserved_qty": "4"}
        ],
        campaign_id="donation_campaign:c1",
        booking_ref="DN-600001",
        tracking_token="TX-SH001-EXPIRED001",
        tracking_token_hash="hash-expired-001",
        status="declared",
        synced_to_couch=True,
        created_at=now - timedelta(hours=80),
        expires_at=now - timedelta(hours=8),
    ).insert()

    await purge_expired_buffers("test-run-1")

    counter = await DonationNeedCounter.get(counter_id)
    assert counter is not None
    assert counter.reserved_qty == Decimal("0"), "timed-out declared reservation must release its quota"
    assert await DonationBuffer.get("donation:01TESTEXPIRED0000000001") is None


async def test_purge_does_not_release_quota_for_received_buffer(db: None) -> None:
    """A buffer that was actually received keeps its quota consumed even after its
    Mongo staging row ages out and gets garbage-collected."""
    now = datetime.now(UTC)
    counter_id = "SH001:donation_campaign:c2:item:rice"
    await DonationNeedCounter(
        id=counter_id,
        shelter_code="SH001",
        campaign_id="donation_campaign:c2",
        item_id="item:rice",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("4"),
        created_at=now,
        updated_at=now,
    ).insert()
    await DonationBuffer(
        id="donation:01TESTRECEIVED000000001",
        shelter_code="SH001",
        donor=DonorBuffer(name="Received Donor", phone="0810000002"),
        items_declared=[
            {"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 4, "unit": "kg", "reserved_qty": "4"}
        ],
        campaign_id="donation_campaign:c2",
        booking_ref="DN-600002",
        tracking_token="TX-SH001-RECEIVED001",
        tracking_token_hash="hash-received-001",
        status="received",
        synced_to_couch=True,
        created_at=now - timedelta(hours=80),
        expires_at=now - timedelta(hours=8),
    ).insert()

    await purge_expired_buffers("test-run-2")

    counter = await DonationNeedCounter.get(counter_id)
    assert counter is not None
    assert counter.reserved_qty == Decimal("4"), "received donations keep their quota consumed"


async def test_retention_cycle_runs_the_reservation_ttl_sweep(db: None) -> None:
    """The TTL sweep must stay wired into the loop — it has no other scheduler."""
    couch = AsyncMock()
    with patch(
        "worker.retention.job.expire_declared_donations", new_callable=AsyncMock
    ) as sweep:
        await run_retention_once(couch)

    sweep.assert_awaited_once()
    assert sweep.await_args.args[0] is couch


async def test_retention_cycle_skips_the_sweep_without_a_couch_client(db: None) -> None:
    with patch(
        "worker.retention.job.expire_declared_donations", new_callable=AsyncMock
    ) as sweep:
        await run_retention_once()

    sweep.assert_not_awaited()
