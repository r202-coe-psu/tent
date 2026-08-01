"""Tests for CouchDB → Mongo change processing."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from worker.couch.processor import process_change


@pytest.mark.asyncio
async def test_process_donation_change_reprojects_needs():
    couch = AsyncMock()
    need_payload = {"_id": "SH001:item:rice", "qty_needed": 3.0}
    donation_doc = {
        "_id": "donation:01TEST",
        "type": "donation",
        "status": "declared",
        "campaign_id": "donation_campaign:01",
        "items": [{"item_id": "item:rice", "qty": "2"}],
    }
    change = {"seq": 42, "id": "donation:01TEST", "doc": donation_doc}

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock) as save_cp,
        patch("worker.couch.processor.apply_donation", new_callable=AsyncMock) as apply_don,
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock) as apply_need,
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[("upsert", need_payload)],
        ) as project_needs,
        patch(
            "worker.couch.processor.project_donation",
            return_value=("upsert", {"_id": "donation:01TEST"}),
        ),
    ):
        await process_change(couch, "shelter_sh001", change)

    apply_don.assert_awaited_once()
    project_needs.assert_awaited_once_with(couch, "SH001")
    apply_need.assert_awaited_once_with("upsert", need_payload)
    save_cp.assert_awaited_once_with("shelter_sh001", 42)


@pytest.mark.asyncio
async def test_process_donation_change_settles_quota():
    """A donation CDC event must settle the reservation, not just reproject the board.

    The BFF cancels a synced donation by writing CouchDB directly, so the change feed is
    the only place that sees it — nothing else would release the counter.
    """
    couch = AsyncMock()
    donation_doc = {
        "_id": "donation:01TEST",
        "type": "donation",
        "status": "cancelled",
        "tracking_token_hash": "hash-1",
        "campaign_id": "donation_campaign:01",
        "items": [{"item_id": "item:rice", "qty": "2"}],
    }
    change = {"seq": 47, "id": "donation:01TEST", "doc": donation_doc}

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_donation", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "worker.couch.processor.project_donation",
            return_value=("upsert", {"_id": "donation:01TEST"}),
        ),
        patch(
            "worker.couch.processor.settle_donation_quota", new_callable=AsyncMock
        ) as settle,
    ):
        await process_change(couch, "shelter_sh001", change)

    settle.assert_awaited_once()
    assert settle.await_args.args[0] is donation_doc


@pytest.mark.asyncio
async def test_process_deleted_donation_reprojects_needs():
    couch = AsyncMock()
    need_payload = {"_id": "SH001:item:rice", "qty_needed": 5.0}
    change = {"seq": 43, "id": "donation:01TEST", "deleted": True}

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock) as save_cp,
        patch("worker.couch.processor.apply_person", new_callable=AsyncMock) as apply_person,
        patch("worker.couch.processor.apply_donation", new_callable=AsyncMock) as apply_don,
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock) as apply_need,
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[("upsert", need_payload)],
        ) as project_needs,
    ):
        await process_change(couch, "shelter_sh001", change)

    apply_person.assert_awaited_once_with("delete", {"_id": "donation:01TEST"})
    apply_don.assert_awaited_once_with("delete", {"_id": "donation:01TEST"})
    project_needs.assert_awaited_once_with(couch, "SH001")
    apply_need.assert_awaited_once_with("upsert", need_payload)
    save_cp.assert_awaited_once_with("shelter_sh001", 43)


@pytest.mark.asyncio
async def test_process_campaign_change_still_reprojects_needs():
    couch = AsyncMock()
    need_payload = {"_id": "SH001:item:rice", "qty_needed": 10.0}
    change = {
        "seq": 44,
        "id": "donation_campaign:01",
        "doc": {
            "_id": "donation_campaign:01",
            "type": "donation_campaign",
            "status": "open",
        },
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock) as apply_need,
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[("upsert", need_payload)],
        ) as project_needs,
    ):
        await process_change(couch, "shelter_sh001", change)

    project_needs.assert_awaited_once_with(couch, "SH001")
    apply_need.assert_awaited_once_with("upsert", need_payload)


@pytest.mark.asyncio
async def test_process_campaign_change_seeds_need_counters():
    """CR-060 — a donation_campaign CDC event seeds the quota ceiling for each need."""
    couch = AsyncMock()
    change = {
        "seq": 45,
        "id": "donation_campaign:01",
        "doc": {
            "_id": "donation_campaign:01",
            "type": "donation_campaign",
            "status": "open",
            "needs": [
                {"item_id": "item:rice", "qty_target": "10"},
                {"item_id": "item:water", "qty_target": "25"},
            ],
        },
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "worker.couch.processor.apply_need_counters", new_callable=AsyncMock
        ) as apply_counters,
    ):
        await process_change(couch, "shelter_sh001", change)

    seeds = apply_counters.await_args.args[0]
    assert [(s.shelter_code, s.item_id, s.qty_target) for s in seeds] == [
        ("SH001", "item:rice", Decimal("10")),
        ("SH001", "item:water", Decimal("25")),
    ]


@pytest.mark.asyncio
async def test_process_supply_item_change_does_not_seed_need_counters():
    couch = AsyncMock()
    change = {
        "seq": 46,
        "id": "item:rice",
        "doc": {"_id": "item:rice", "type": "supply_item"},
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "worker.couch.processor.apply_need_counters", new_callable=AsyncMock
        ) as apply_counters,
    ):
        await process_change(couch, "shelter_sh001", change)

    apply_counters.assert_not_awaited()
