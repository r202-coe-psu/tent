"""Tests for the quota backfill / recalculation core (CR-047 §Migration & Maintenance)."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock

import bson
import pytest
from tent_model import DonationBuffer, DonationNeedCounter, DonorBuffer, seed_counter

from worker.quota.reconcile import (
    ShelterReconcileReport,
    reconcile_shelter,
    sum_reserved_by_key,
)

SHELTER = "SH001"
CAMPAIGN = "donation_campaign:01"
RICE = ("donation_campaign:01", "item:rice")


# --- pure aggregation ---


def test_sums_only_quota_holding_statuses():
    donations = [
        {"_id": "donation:1", "campaign_id": CAMPAIGN, "status": "declared", "items": [
            {"item_id": "item:rice", "qty": "3"}
        ]},
        {"_id": "donation:2", "campaign_id": CAMPAIGN, "status": "received", "items": [
            {"item_id": "item:rice", "qty": "4"}
        ]},
        {"_id": "donation:3", "campaign_id": CAMPAIGN, "status": "cancelled", "items": [
            {"item_id": "item:rice", "qty": "100"}
        ]},
        {"_id": "donation:4", "campaign_id": CAMPAIGN, "status": "expired", "items": [
            {"item_id": "item:rice", "qty": "100"}
        ]},
    ]
    assert sum_reserved_by_key(donations) == {RICE: Decimal("7")}


def test_received_donations_still_hold_quota():
    """The regression the buffer-only source would cause: received must keep counting."""
    donations = [
        {"_id": "donation:1", "campaign_id": CAMPAIGN, "status": "received", "items": [
            {"item_id": "item:rice", "qty": "10"}
        ]},
    ]
    assert sum_reserved_by_key(donations) == {RICE: Decimal("10")}


def test_reports_unattributable_items_instead_of_guessing():
    report = ShelterReconcileReport(shelter_code=SHELTER)
    donations = [
        # free-text only — no item_id to attribute to a counter
        {"_id": "donation:1", "campaign_id": CAMPAIGN, "status": "declared", "items": [
            {"free_text": "ข้าวสาร", "qty": "5"}
        ]},
        # no campaign at all (walk-in outside any campaign)
        {"_id": "donation:2", "campaign_id": None, "status": "declared", "items": [
            {"item_id": "item:rice", "qty": "5"}
        ]},
    ]
    assert sum_reserved_by_key(donations, report=report) == {}
    assert len(report.unattributed_items) == 2


def test_skips_unusable_qty():
    donations = [
        {"_id": "donation:1", "campaign_id": CAMPAIGN, "status": "declared", "items": [
            {"item_id": "item:rice", "qty": "abc"},
            {"item_id": "item:rice", "qty": "0"},
            {"item_id": "item:rice", "qty": "-5"},
            {"item_id": "item:rice", "qty": "2"},
        ]},
    ]
    assert sum_reserved_by_key(donations) == {RICE: Decimal("2")}


# --- reconcile against Mongo ---


def _couch_stub(donation_docs, *, db_exists=True):
    async def iter_all_docs(_database):
        for doc in donation_docs:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=db_exists)
    couch.iter_all_docs = iter_all_docs
    return couch


async def _seed(qty_target: str = "50", item_id: str = "item:rice") -> None:
    await seed_counter(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id=item_id,
        qty_target=Decimal(qty_target),
        now=datetime.now(UTC),
    )


async def _reserved(item_id: str = "item:rice") -> Decimal:
    counter = await DonationNeedCounter.find_one(
        DonationNeedCounter.shelter_code == SHELTER,
        DonationNeedCounter.item_id == item_id,
    )
    assert counter is not None
    return counter.reserved_qty


async def test_dry_run_reports_but_writes_nothing(db: None) -> None:
    await _seed()
    couch = _couch_stub(
        [
            {"_id": "donation:1", "type": "donation", "campaign_id": CAMPAIGN,
             "status": "declared", "items": [{"item_id": "item:rice", "qty": "12"}]},
        ]
    )

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=False)

    assert report.changes == [(RICE, Decimal("0"), Decimal("12"))]
    assert report.counters_changed == 0
    assert await _reserved() == Decimal("0")


async def test_apply_writes_recomputed_reserved_qty(db: None) -> None:
    await _seed()
    couch = _couch_stub(
        [
            {"_id": "donation:1", "type": "donation", "campaign_id": CAMPAIGN,
             "status": "declared", "items": [{"item_id": "item:rice", "qty": "12"}]},
            {"_id": "donation:2", "type": "donation", "campaign_id": CAMPAIGN,
             "status": "received", "items": [{"item_id": "item:rice", "qty": "8"}]},
        ]
    )

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)

    assert report.counters_changed == 1
    assert report.counters_conflicted == 0
    assert await _reserved() == Decimal("20")


async def test_apply_stamps_last_recalculated_at(db: None) -> None:
    await _seed()
    couch = _couch_stub(
        [
            {"_id": "donation:1", "type": "donation", "campaign_id": CAMPAIGN,
             "status": "declared", "items": [{"item_id": "item:rice", "qty": "1"}]},
        ]
    )
    now = datetime.now(UTC)

    await reconcile_shelter(couch, SHELTER, now=now, apply=True)

    counter = await DonationNeedCounter.find_one(DonationNeedCounter.shelter_code == SHELTER)
    assert counter is not None
    assert counter.last_recalculated_at is not None


async def test_drift_downward_is_corrected(db: None) -> None:
    """A counter left too high (e.g. a release that never landed) is brought back down."""
    await _seed()
    await DonationNeedCounter.get_motor_collection().update_one(
        {"shelter_code": SHELTER}, {"$set": {"reserved_qty": bson.Decimal128("40")}}
    )
    couch = _couch_stub(
        [
            {"_id": "donation:1", "type": "donation", "campaign_id": CAMPAIGN,
             "status": "declared", "items": [{"item_id": "item:rice", "qty": "5"}]},
        ]
    )

    await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)

    assert await _reserved() == Decimal("5")


async def test_counter_with_no_outstanding_donations_resets_to_zero(db: None) -> None:
    await _seed()
    await DonationNeedCounter.get_motor_collection().update_one(
        {"shelter_code": SHELTER}, {"$set": {"reserved_qty": bson.Decimal128("9")}}
    )
    couch = _couch_stub([])

    await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)

    assert await _reserved() == Decimal("0")


async def test_counts_unsynced_buffer_not_yet_in_couch(db: None) -> None:
    await _seed()
    now = datetime.now(UTC)
    await DonationBuffer(
        id="donation:pending",
        shelter_code=SHELTER,
        donor=DonorBuffer(name="ก", phone="0810000000"),
        items_declared=[{"item_id": "item:rice", "qty": "6"}],
        campaign_id=CAMPAIGN,
        booking_ref="DN-000001",
        tracking_token="TX-SH001-AAAAAAAA",
        tracking_token_hash="hash-pending",
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    couch = _couch_stub([])
    await reconcile_shelter(couch, SHELTER, now=now, apply=True)

    assert await _reserved() == Decimal("6")


async def test_synced_buffer_and_couch_doc_are_not_double_counted(db: None) -> None:
    await _seed()
    now = datetime.now(UTC)
    # Stale synced flag: inbound already wrote the CouchDB doc for this same donation.
    await DonationBuffer(
        id="donation:1",
        shelter_code=SHELTER,
        donor=DonorBuffer(name="ก", phone="0810000000"),
        items_declared=[{"item_id": "item:rice", "qty": "6"}],
        campaign_id=CAMPAIGN,
        booking_ref="DN-000002",
        tracking_token="TX-SH001-BBBBBBBB",
        tracking_token_hash="hash-dup",
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    couch = _couch_stub(
        [
            {"_id": "donation:1", "type": "donation", "campaign_id": CAMPAIGN,
             "status": "declared", "items": [{"item_id": "item:rice", "qty": "6"}]},
        ]
    )
    await reconcile_shelter(couch, SHELTER, now=now, apply=True)

    assert await _reserved() == Decimal("6")


async def test_concurrent_booking_is_reported_as_conflict_not_overwritten(db: None) -> None:
    """CR-047 Cutover Lock — a $inc landing mid-run must abort that counter's write."""
    await _seed()
    collection = DonationNeedCounter.get_motor_collection()

    original = collection.find

    def racing_find(*args, **kwargs):
        # Simulate a booking that lands between the read and the write by mutating
        # reserved_qty right after the counters are read.
        cursor = original(*args, **kwargs)
        real_to_list = cursor.to_list

        async def to_list(*a, **k):
            docs = await real_to_list(*a, **k)
            await collection.update_one(
                {"shelter_code": SHELTER}, {"$inc": {"reserved_qty": bson.Decimal128("2")}}
            )
            return docs

        cursor.to_list = to_list
        return cursor

    collection.find = racing_find
    try:
        couch = _couch_stub(
            [
                {"_id": "donation:1", "type": "donation", "campaign_id": CAMPAIGN,
                 "status": "declared", "items": [{"item_id": "item:rice", "qty": "5"}]},
            ]
        )
        report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)
    finally:
        collection.find = original

    assert report.counters_conflicted == 1
    assert report.conflicts == [RICE]
    # The live booking survives — recalculation did not stomp it back to 5.
    assert await _reserved() == Decimal("2")


@pytest.mark.parametrize("db_exists", [True, False])
async def test_missing_couch_database_falls_back_to_buffers(db: None, db_exists: bool) -> None:
    await _seed()
    couch = _couch_stub([], db_exists=db_exists)
    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=False)
    assert report.counters_examined == 1


async def test_reports_outstanding_qty_with_no_counter_yet(db: None) -> None:
    """First backfill dry run: no counters exist, so the value lives in missing_counters."""
    couch = _couch_stub(
        [
            {"_id": "donation:1", "type": "donation", "campaign_id": CAMPAIGN,
             "status": "declared", "items": [{"item_id": "item:rice", "qty": "50"}]},
        ]
    )

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=False)

    assert report.counters_examined == 0
    assert report.changes == []
    assert report.missing_counters == [(RICE, Decimal("50"))]


async def test_seeded_counter_is_not_reported_as_missing(db: None) -> None:
    await _seed()
    couch = _couch_stub(
        [
            {"_id": "donation:1", "type": "donation", "campaign_id": CAMPAIGN,
             "status": "declared", "items": [{"item_id": "item:rice", "qty": "50"}]},
        ]
    )

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=False)

    assert report.missing_counters == []
