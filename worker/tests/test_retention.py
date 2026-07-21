"""Tests for retention helpers."""

import pytest

from worker.projectors.compute_needs import compute_needs


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
