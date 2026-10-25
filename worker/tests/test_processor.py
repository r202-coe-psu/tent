"""Tests for CouchDB → Mongo change processing."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.couch.processor import process_change


@pytest.fixture(autouse=True)
def shelter_projected():
    """Every shelter counts as listed in `public_shelters` unless a test says otherwise."""
    with patch(
        "worker.couch.processor.is_shelter_projected",
        new_callable=AsyncMock,
        return_value=True,
    ) as projected:
        yield projected


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


async def _process_ledger_change(change: dict) -> tuple[AsyncMock, list[str]]:
    """Run one stock_ledger change; return the couch stub and the order of the steps."""
    couch = AsyncMock()
    steps = MagicMock()
    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_person", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_need", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ) as project_needs,
        patch(
            "worker.couch.processor.refresh_on_hand", new_callable=AsyncMock
        ) as refresh,
        patch(
            "worker.couch.processor.settle_shelved_quota", new_callable=AsyncMock
        ) as settle,
        patch("worker.couch.processor.refresh_shelter_stock", new_callable=AsyncMock),
    ):
        steps.attach_mock(refresh, "refresh_on_hand")
        steps.attach_mock(settle, "settle_shelved_quota")
        steps.attach_mock(project_needs, "project_needs_for_shelter")
        await process_change(couch, "shelter_sh001", change)

    for name in ("refresh_on_hand", "project_needs_for_shelter"):
        getattr(steps, name).assert_awaited_once_with(couch, "SH001")
    tracked = {"refresh_on_hand", "settle_shelved_quota", "project_needs_for_shelter"}
    order = [c[0] for c in steps.mock_calls if c[0] in tracked]
    return couch, order


def _ledger_change(reason: str) -> dict:
    return {
        "seq": 60,
        "id": "stock_ledger:01",
        "doc": {
            "_id": "stock_ledger:01",
            "type": "stock_ledger",
            "reason": reason,
            "ref_id": "donation:01" if reason == "donation" else None,
            "item_id": "item:rice",
            "qty": "270",
        },
    }


@pytest.mark.asyncio
async def test_process_stock_ledger_change_refreshes_the_ceiling():
    """Goods on the shelf lower what still has to be donated — and the booking ceiling.

    Nothing reacted to a ledger entry before this: the board kept advertising the old
    shortfall and the counter kept accepting bookings against the bare qty_target.

    A donation receipt also leaves reserved_qty, or the ceiling drops twice — and it
    must do so before the board is re-projected: the board showing the goods on the
    shelf is the signal that the counter has let go of them (the e2e relies on it).
    """
    _, order = await _process_ledger_change(_ledger_change("donation"))

    assert order == [
        "refresh_on_hand",
        "settle_shelved_quota",
        "project_needs_for_shelter",
    ]


@pytest.mark.asyncio
async def test_non_donation_ledger_row_skips_the_quota_reconcile():
    """An issue or adjustment moves on_hand only — no booking owes less because of it,
    so the whole-shelter reconcile is not worth its scan."""
    _, order = await _process_ledger_change(_ledger_change("distribute"))

    assert order == ["refresh_on_hand", "project_needs_for_shelter"]


@pytest.mark.asyncio
async def test_process_deleted_stock_ledger_raises_the_ceiling_back():
    """A delete row carries no doc, so the branch keys off the id prefix instead — and
    with no reason to read, a removed donation row is assumed and reconciled."""
    _, order = await _process_ledger_change(
        {"seq": 61, "id": "stock_ledger:01", "deleted": True}
    )

    assert order == [
        "refresh_on_hand",
        "settle_shelved_quota",
        "project_needs_for_shelter",
    ]


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
        patch(
            "worker.couch.processor.refresh_shelter_occupants", new_callable=AsyncMock
        ) as refresh_occ,
        patch(
            "worker.couch.processor.sync_booking_stay", new_callable=AsyncMock
        ) as sync_stay,
    ):
        await process_change(couch, "shelter_sh001", change)

    refresh.assert_awaited_once_with(couch, "SH001")
    refresh_occ.assert_awaited_once_with(couch, "SH001")
    # PDPA D8: EXT-009 reads the stay from the booking row when the person is not projected.
    sync_stay.assert_awaited_once_with(change["doc"])


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
        patch(
            "worker.couch.processor.refresh_shelter_occupants", new_callable=AsyncMock
        ) as refresh_occ,
    ):
        await process_change(couch, "shelter_sh001", change)

    refresh.assert_awaited_once_with(couch, "SH001")
    refresh_occ.assert_awaited_once_with(couch, "SH001")


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
        patch(
            "worker.couch.processor.delete_stocks_for_shelter", new_callable=AsyncMock
        ) as del_stocks,
    ):
        await process_change(couch, "registry", change)

    deactivate.assert_awaited_once_with("SH001")
    del_persons.assert_awaited_once_with("SH001")
    del_needs.assert_awaited_once_with("SH001")
    # #461 — the stock projection must not outlive the shelter it describes.
    del_stocks.assert_awaited_once_with("SH001")
    save_cp.assert_awaited_once_with("registry", 77)


@pytest.mark.asyncio
async def test_process_registry_cancelled_shelter_deletes_its_projections():
    """A registry doc that projects to `delete` (cancelled shelter) drops the row and
    every shelter-scoped projection — `shelter_stocks` rows included (#461)."""
    couch = AsyncMock()
    change = {
        "seq": 78,
        "id": "shelter:01CANCELLED",
        "doc": {
            "_id": "shelter:01CANCELLED",
            "type": "shelter",
            "code": "SH002",
            "operation_status": "cancelled",
        },
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.apply_shelter", new_callable=AsyncMock
        ) as apply_shelter,
        patch(
            "worker.couch.processor.delete_persons_for_shelter", new_callable=AsyncMock
        ) as del_persons,
        patch(
            "worker.couch.processor.delete_occupants_for_shelter",
            new_callable=AsyncMock,
        ) as del_occupants,
        patch(
            "worker.couch.processor.delete_needs_for_shelter", new_callable=AsyncMock
        ) as del_needs,
        patch(
            "worker.couch.processor.delete_stocks_for_shelter", new_callable=AsyncMock
        ) as del_stocks,
        patch(
            "worker.couch.processor.delete_jobs_for_shelter", new_callable=AsyncMock
        ) as del_jobs,
        patch(
            "worker.couch.processor._reproject_shelter_database", new_callable=AsyncMock
        ) as reproject,
    ):
        await process_change(couch, "registry", change)

    apply_shelter.assert_awaited_once_with("delete", {"_id": "SH002"})
    del_persons.assert_awaited_once_with("SH002")
    del_occupants.assert_awaited_once_with("SH002")
    del_needs.assert_awaited_once_with("SH002")
    del_stocks.assert_awaited_once_with("SH002")
    del_jobs.assert_awaited_once_with("SH002")
    reproject.assert_not_awaited()


@pytest.mark.asyncio
async def test_process_registry_shelter_relisted_rescans_its_database(
    shelter_projected: AsyncMock,
):
    """Reverting `cancelled` (no public row yet) rebuilds the shelter DB's projections —
    its changes were skipped while it was hidden."""
    shelter_projected.return_value = False
    couch = AsyncMock()
    couch.database_exists.return_value = True
    change = {
        "seq": 79,
        "id": "shelter:01BACK",
        "doc": {
            "_id": "shelter:01BACK",
            "type": "shelter",
            "code": "SH003",
            "operation_status": "standby",
        },
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.apply_shelter", new_callable=AsyncMock
        ) as apply_shelter,
        patch(
            "worker.couch.bootstrap.bootstrap_database", new_callable=AsyncMock
        ) as bootstrap_db,
    ):
        await process_change(couch, "registry", change)

    assert apply_shelter.await_args.args[0] == "upsert"
    couch.database_exists.assert_awaited_once_with("shelter_sh003")
    bootstrap_db.assert_awaited_once_with(couch, "shelter_sh003")


@pytest.mark.asyncio
async def test_process_registry_shelter_already_listed_does_not_rescan():
    couch = AsyncMock()
    change = {
        "seq": 80,
        "id": "shelter:01OPEN",
        "doc": {
            "_id": "shelter:01OPEN",
            "type": "shelter",
            "code": "SH004",
            "operation_status": "active",
        },
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_shelter", new_callable=AsyncMock),
        patch(
            "worker.couch.bootstrap.bootstrap_database", new_callable=AsyncMock
        ) as bootstrap_db,
    ):
        await process_change(couch, "registry", change)

    bootstrap_db.assert_not_awaited()


@pytest.mark.asyncio
async def test_process_change_skips_a_cancelled_shelters_database(
    shelter_projected: AsyncMock,
):
    """No public row (cancelled) → a shelter-DB change projects nothing, but the
    checkpoint still advances."""
    shelter_projected.return_value = False
    couch = AsyncMock()
    change = {
        "seq": 81,
        "id": "evacuee:01X",
        "doc": {"_id": "evacuee:01X", "type": "evacuee"},
    }

    with (
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch(
            "worker.couch.processor.apply_person", new_callable=AsyncMock
        ) as apply_person,
        patch(
            "worker.couch.processor.refresh_shelter_occupants", new_callable=AsyncMock
        ) as refresh_occupants,
    ):
        await process_change(couch, "shelter_sh005", change)

    shelter_projected.assert_awaited_once_with("SH005")
    apply_person.assert_not_awaited()
    refresh_occupants.assert_not_awaited()
    save_cp.assert_awaited_once_with("shelter_sh005", 81)
