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
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch(
            "worker.couch.processor.apply_donation", new_callable=AsyncMock
        ) as apply_don,
        patch(
            "worker.couch.processor.apply_need", new_callable=AsyncMock
        ) as apply_need,
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[("upsert", need_payload)],
        ) as project_needs,
        patch(
            "worker.couch.processor.project_donation",
            return_value=("upsert", {"_id": "donation:01TEST"}),
        ),
        patch("worker.couch.processor.reserve_walk_in_quota", new_callable=AsyncMock),
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
        patch("worker.couch.processor.refresh_on_hand", new_callable=AsyncMock),
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
async def test_process_donation_change_counts_a_walk_in():
    """A donation staff keyed in never reserved — the counter has to pick it up.

    Only FastAPI's public path calls reserve_quota. Without this the counter reported
    less than the shelter actually owed and handed the difference back out to donors.
    """
    couch = AsyncMock()
    walk_in = {
        "_id": "donation:01WALKIN",
        "type": "donation",
        "status": "declared",
        "campaign_id": "donation_campaign:01",
        "items": [{"item_id": "item:rice", "qty": "40"}],
    }
    change = {"seq": 48, "id": "donation:01WALKIN", "doc": walk_in}

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_donation", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch("worker.couch.processor.refresh_on_hand", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_donation",
            return_value=("upsert", {"_id": "donation:01WALKIN"}),
        ),
        patch("worker.couch.processor.settle_donation_quota", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.reserve_walk_in_quota", new_callable=AsyncMock
        ) as walk_in_quota,
    ):
        await process_change(couch, "shelter_sh001", change)

    walk_in_quota.assert_awaited_once()
    assert walk_in_quota.await_args.args[1] is walk_in
    assert walk_in_quota.await_args.kwargs["shelter_code"] == "SH001"


@pytest.mark.asyncio
async def test_process_deleted_donation_reprojects_needs():
    couch = AsyncMock()
    need_payload = {"_id": "SH001:item:rice", "qty_needed": 5.0}
    change = {"seq": 43, "id": "donation:01TEST", "deleted": True}

    with (
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch(
            "worker.couch.processor.apply_person", new_callable=AsyncMock
        ) as apply_person,
        patch(
            "worker.couch.processor.apply_donation", new_callable=AsyncMock
        ) as apply_don,
        patch(
            "worker.couch.processor.apply_need", new_callable=AsyncMock
        ) as apply_need,
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
        patch(
            "worker.couch.processor.apply_need", new_callable=AsyncMock
        ) as apply_need,
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[("upsert", need_payload)],
        ) as project_needs,
        patch("worker.couch.processor.refresh_on_hand", new_callable=AsyncMock),
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
        patch("worker.couch.processor.refresh_on_hand", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.apply_need_counters", new_callable=AsyncMock
        ) as apply_counters,
    ):
        await process_change(couch, "shelter_sh001", change)

    seeds = apply_counters.await_args.args[0]
    assert [(s.shelter_code, s.item_id, s.qty_target) for s in seeds] == [
        ("SH001", "item:rice", Decimal(10)),
        ("SH001", "item:water", Decimal(25)),
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
        patch("worker.couch.processor.refresh_on_hand", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.apply_need_counters", new_callable=AsyncMock
        ) as apply_counters,
    ):
        await process_change(couch, "shelter_sh001", change)

    apply_counters.assert_not_awaited()


@pytest.mark.asyncio
async def test_process_stock_ledger_change_refreshes_the_ceiling():
    """Goods on the shelf lower what still has to be donated — and the booking ceiling.

    Nothing reacted to a ledger entry before this: the board kept advertising the old
    shortfall and the counter kept accepting bookings against the bare qty_target.
    """
    couch = AsyncMock()
    change = {
        "seq": 60,
        "id": "stock_ledger:01",
        "doc": {
            "_id": "stock_ledger:01",
            "type": "stock_ledger",
            "item_id": "item:rice",
            "qty": "270",
        },
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ) as project_needs,
        patch(
            "worker.couch.processor.refresh_on_hand", new_callable=AsyncMock
        ) as refresh,
        patch("worker.couch.processor.refresh_shelter_stock", new_callable=AsyncMock),
    ):
        await process_change(couch, "shelter_sh001", change)

    refresh.assert_awaited_once_with(couch, "SH001")
    project_needs.assert_awaited_once_with(couch, "SH001")


@pytest.mark.asyncio
async def test_process_deleted_stock_ledger_raises_the_ceiling_back():
    """A delete row carries no doc, so the branch keys off the id prefix instead."""
    couch = AsyncMock()
    change = {"seq": 61, "id": "stock_ledger:01", "deleted": True}

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_person", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "worker.couch.processor.refresh_on_hand", new_callable=AsyncMock
        ) as refresh,
        patch("worker.couch.processor.refresh_shelter_stock", new_callable=AsyncMock),
    ):
        await process_change(couch, "shelter_sh001", change)

    refresh.assert_awaited_once_with(couch, "SH001")


@pytest.mark.asyncio
async def test_process_evacuee_change_refreshes_occupancy():
    """EXT-005 — a check-in/out or any evacuee field change shifts the headcount."""
    couch = AsyncMock()
    change = {
        "seq": 62,
        "id": "evacuee:01",
        "doc": {
            "_id": "evacuee:01",
            "type": "evacuee",
            "current_stay": {"status": "active"},
        },
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_person", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_evacuee",
            return_value=("upsert", {"_id": "evacuee:01"}),
        ),
        patch(
            "worker.couch.processor.refresh_occupancy", new_callable=AsyncMock
        ) as refresh,
    ):
        await process_change(couch, "shelter_sh001", change)

    refresh.assert_awaited_once_with(couch, "SH001")


@pytest.mark.asyncio
async def test_process_deleted_evacuee_refreshes_occupancy():
    couch = AsyncMock()
    change = {"seq": 63, "id": "evacuee:01", "deleted": True}

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_person", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.refresh_occupancy", new_callable=AsyncMock
        ) as refresh,
    ):
        await process_change(couch, "shelter_sh001", change)

    refresh.assert_awaited_once_with(couch, "SH001")


@pytest.mark.asyncio
async def test_process_stock_threshold_override_change_refreshes_stock():
    couch = AsyncMock()
    change = {
        "seq": 64,
        "id": "stock_threshold_override:SH001:item:rice",
        "doc": {
            "_id": "stock_threshold_override:SH001:item:rice",
            "type": "stock_threshold_override",
            "item_id": "item:rice",
            "reorder_level": 50,
        },
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.refresh_shelter_stock", new_callable=AsyncMock
        ) as refresh,
    ):
        await process_change(couch, "shelter_sh001", change)

    refresh.assert_awaited_once_with(couch, "SH001")


@pytest.mark.asyncio
async def test_process_registry_shelter_tombstone_deactivates_not_deletes():
    """True CouchDB delete/archive signal — per the partner ODT, flip `is_active` False
    rather than hard-deleting the `public_shelters` row (M6 keeps historical reference)."""
    couch = AsyncMock()
    change = {"seq": 77, "id": "shelter:01ARCHIVED", "deleted": True}

    with (
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch(
            "worker.couch.processor.resolve_shelter_code_for_registry_delete",
            new_callable=AsyncMock,
            return_value="SH001",
        ),
        patch(
            "worker.couch.processor.apply_shelter_deactivate", new_callable=AsyncMock
        ) as deactivate,
        patch(
            "worker.couch.processor.delete_persons_for_shelter", new_callable=AsyncMock
        ) as del_persons,
        patch(
            "worker.couch.processor.delete_needs_for_shelter", new_callable=AsyncMock
        ) as del_needs,
    ):
        await process_change(couch, "registry", change)

    deactivate.assert_awaited_once_with("SH001")
    del_persons.assert_awaited_once_with("SH001")
    del_needs.assert_awaited_once_with("SH001")
    save_cp.assert_awaited_once_with("registry", 77)
