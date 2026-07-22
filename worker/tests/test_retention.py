"""Tests for retention helpers."""

from datetime import UTC, datetime, timedelta

from worker.projectors.compute_needs import compute_needs
from worker.retention.job import classify_expired_buffer


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
