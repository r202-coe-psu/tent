"""Tests for CouchDB → Mongo change processing."""

from __future__ import annotations

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
