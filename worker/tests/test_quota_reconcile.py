"""Tests for the quota backfill / recalculation core (CR-047 §Migration & Maintenance)."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock

import bson
import pytest
from tent_model import (
    DonationBuffer,
    DonationNeedCounter,
    DonorBuffer,
    ReserveResult,
    reserve_quota,
    seed_counter,
    set_on_hand_qty,
)

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
        {
            "_id": "donation:1",
            "campaign_id": CAMPAIGN,
            "status": "declared",
            "items": [{"item_id": "item:rice", "qty": "3"}],
        },
        {
            "_id": "donation:2",
            "campaign_id": CAMPAIGN,
            "status": "received",
            "items": [{"item_id": "item:rice", "qty": "4"}],
        },
        {
            "_id": "donation:3",
            "campaign_id": CAMPAIGN,
            "status": "cancelled",
            "items": [{"item_id": "item:rice", "qty": "100"}],
        },
        {
            "_id": "donation:4",
            "campaign_id": CAMPAIGN,
            "status": "expired",
            "items": [{"item_id": "item:rice", "qty": "100"}],
        },
    ]
    assert sum_reserved_by_key(donations) == {RICE: Decimal(7)}


def test_received_donations_still_hold_quota():
    """The regression the buffer-only source would cause: received must keep counting."""
    donations = [
        {
            "_id": "donation:1",
            "campaign_id": CAMPAIGN,
            "status": "received",
            "items": [{"item_id": "item:rice", "qty": "10"}],
        },
    ]
    assert sum_reserved_by_key(donations) == {RICE: Decimal(10)}


def test_reports_unattributable_items_instead_of_guessing():
    report = ShelterReconcileReport(shelter_code=SHELTER)
    donations = [
        # free-text only — no item_id to attribute to a counter
        {
            "_id": "donation:1",
            "campaign_id": CAMPAIGN,
            "status": "declared",
            "items": [{"free_text": "ข้าวสาร", "qty": "5"}],
        },
        # no campaign at all (walk-in outside any campaign)
        {
            "_id": "donation:2",
            "campaign_id": None,
            "status": "declared",
            "items": [{"item_id": "item:rice", "qty": "5"}],
        },
    ]
    assert sum_reserved_by_key(donations, report=report) == {}
    assert len(report.unattributed_items) == 2


def test_skips_unusable_qty():
    donations = [
        {
            "_id": "donation:1",
            "campaign_id": CAMPAIGN,
            "status": "declared",
            "items": [
                {"item_id": "item:rice", "qty": "abc"},
                {"item_id": "item:rice", "qty": "0"},
                {"item_id": "item:rice", "qty": "-5"},
                {"item_id": "item:rice", "qty": "2"},
            ],
        },
    ]
    assert sum_reserved_by_key(donations) == {RICE: Decimal(2)}


def _ledger(
    ref_id: str, qty: str, item_id: str = "item:rice", reason: str = "donation"
):
    return {
        "_id": f"stock_ledger:{ref_id}:{item_id}:{qty}",
        "type": "stock_ledger",
        "reason": reason,
        "ref_id": ref_id,
        "item_id": item_id,
        "qty": qty,
    }


def test_received_and_shelved_donation_no_longer_holds_quota():
    """Goods in the ledger sit in on_hand_qty — counting them here too took them off
    the ceiling twice (board showed 89 open, a booking of 89 came back NEED_FULL)."""
    donations = [
        {
            "_id": "donation:1",
            "campaign_id": CAMPAIGN,
            "status": "received",
            "items": [{"item_id": "item:rice", "qty": "11"}],
        },
        {
            "_id": "donation:2",
            "campaign_id": CAMPAIGN,
            "status": "declared",
            "items": [{"item_id": "item:rice", "qty": "5"}],
        },
    ]
    ledgers = [_ledger("donation:1", "11")]
    assert sum_reserved_by_key(donations, stock_ledgers=ledgers) == {RICE: Decimal(5)}


def test_received_donation_not_yet_shelved_still_holds_quota():
    donations = [
        {
            "_id": "donation:1",
            "campaign_id": CAMPAIGN,
            "status": "received",
            "items": [{"item_id": "item:rice", "qty": "11"}],
        },
    ]
    ledgers = [_ledger("donation:other", "11")]
    assert sum_reserved_by_key(donations, stock_ledgers=ledgers) == {RICE: Decimal(11)}


def test_interrupted_batch_receipt_holds_only_what_is_still_owed():
    """CR-143 FR-B7: an outstanding donation with some rows keyed owes the rest."""
    donations = [
        {
            "_id": "donation:1",
            "campaign_id": CAMPAIGN,
            "status": "declared",
            "items": [
                {"item_id": "item:rice", "qty": "10"},
                {"item_id": "item:water", "qty": "6"},
            ],
        },
    ]
    ledgers = [
        _ledger("donation:1", "4"),
        _ledger("donation:1", "6", item_id="item:water"),
    ]
    assert sum_reserved_by_key(donations, stock_ledgers=ledgers) == {RICE: Decimal(6)}


def test_non_donation_and_issue_rows_do_not_count_as_recorded():
    donations = [
        {
            "_id": "donation:1",
            "campaign_id": CAMPAIGN,
            "status": "declared",
            "items": [{"item_id": "item:rice", "qty": "10"}],
        },
    ]
    ledgers = [
        _ledger("donation:1", "3", reason="receive"),
        _ledger("donation:1", "-2"),
    ]
    assert sum_reserved_by_key(donations, stock_ledgers=ledgers) == {RICE: Decimal(10)}


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
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "12"}],
            },
        ]
    )

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=False)

    assert report.changes == [(RICE, Decimal(0), Decimal(12))]
    assert report.counters_changed == 0
    assert await _reserved() == Decimal(0)


async def test_apply_writes_recomputed_reserved_qty(db: None) -> None:
    await _seed()
    couch = _couch_stub(
        [
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "12"}],
            },
            {
                "_id": "donation:2",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "received",
                "items": [{"item_id": "item:rice", "qty": "8"}],
            },
        ]
    )

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)

    assert report.counters_changed == 1
    assert report.counters_conflicted == 0
    assert await _reserved() == Decimal(20)


async def test_apply_stamps_last_recalculated_at(db: None) -> None:
    await _seed()
    couch = _couch_stub(
        [
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "1"}],
            },
        ]
    )
    now = datetime.now(UTC)

    await reconcile_shelter(couch, SHELTER, now=now, apply=True)

    counter = await DonationNeedCounter.find_one(
        DonationNeedCounter.shelter_code == SHELTER
    )
    assert counter is not None
    assert counter.last_recalculated_at is not None


async def test_drift_downward_is_corrected(db: None) -> None:
    """A counter left too high (e.g. a release that never landed) is brought back down."""
    await _seed()
    await DonationNeedCounter.get_pymongo_collection().update_one(
        {"shelter_code": SHELTER}, {"$set": {"reserved_qty": bson.Decimal128("40")}}
    )
    couch = _couch_stub(
        [
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "5"}],
            },
        ]
    )

    await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)

    assert await _reserved() == Decimal(5)


async def test_counter_with_no_outstanding_donations_resets_to_zero(db: None) -> None:
    await _seed()
    await DonationNeedCounter.get_pymongo_collection().update_one(
        {"shelter_code": SHELTER}, {"$set": {"reserved_qty": bson.Decimal128("9")}}
    )
    couch = _couch_stub([])

    await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)

    assert await _reserved() == Decimal(0)


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

    assert await _reserved() == Decimal(6)


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
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "6"}],
            },
        ]
    )
    await reconcile_shelter(couch, SHELTER, now=now, apply=True)

    assert await _reserved() == Decimal(6)


async def test_booking_reserved_while_the_truth_set_is_read_is_not_erased(
    db: None,
) -> None:
    """FastAPI reserves the counter first and inserts the buffer after. A booking that
    lands while the shelter is being scanned is in the counter but not in the truth set;
    reading the counters last let set_reserved_qty erase it. Now that reconcile runs on
    every stock ledger change, the counters are read first so the filter catches it."""
    await _seed()
    collection = DonationNeedCounter.get_pymongo_collection()

    async def iter_all_docs(_database):
        yield {
            "_id": "donation:1",
            "type": "donation",
            "campaign_id": CAMPAIGN,
            "status": "declared",
            "items": [{"item_id": "item:rice", "qty": "5"}],
        }
        # Mid-scan: a public booking takes 2 and has not written its buffer yet.
        await collection.update_one(
            {"shelter_code": SHELTER},
            {"$inc": {"reserved_qty": bson.Decimal128("2")}},
        )

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)

    assert report.conflicts == [RICE]
    assert await _reserved() == Decimal(2)


async def test_concurrent_booking_is_reported_as_conflict_not_overwritten(
    db: None,
) -> None:
    """CR-047 Cutover Lock — a $inc landing mid-run must abort that counter's write."""
    await _seed()
    collection = DonationNeedCounter.get_pymongo_collection()

    original = collection.find

    def racing_find(*args, **kwargs):
        # Simulate a booking that lands between the read and the write by mutating
        # reserved_qty right after the counters are read.
        cursor = original(*args, **kwargs)
        real_to_list = cursor.to_list

        async def to_list(*a, **k):
            docs = await real_to_list(*a, **k)
            await collection.update_one(
                {"shelter_code": SHELTER},
                {"$inc": {"reserved_qty": bson.Decimal128("2")}},
            )
            return docs

        cursor.to_list = to_list
        return cursor

    collection.find = racing_find
    try:
        couch = _couch_stub(
            [
                {
                    "_id": "donation:1",
                    "type": "donation",
                    "campaign_id": CAMPAIGN,
                    "status": "declared",
                    "items": [{"item_id": "item:rice", "qty": "5"}],
                },
            ]
        )
        report = await reconcile_shelter(
            couch, SHELTER, now=datetime.now(UTC), apply=True
        )
    finally:
        collection.find = original

    assert report.counters_conflicted == 1
    assert report.conflicts == [RICE]
    # The live booking survives — recalculation did not stomp it back to 5.
    assert await _reserved() == Decimal(2)


@pytest.mark.parametrize("db_exists", [True, False])
async def test_missing_couch_database_falls_back_to_buffers(
    db: None, db_exists: bool
) -> None:
    await _seed()
    couch = _couch_stub([], db_exists=db_exists)
    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=False)
    assert report.counters_examined == 1


async def test_reports_outstanding_qty_with_no_counter_yet(db: None) -> None:
    """First backfill dry run: no counters exist, so the value lives in missing_counters."""
    couch = _couch_stub(
        [
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "50"}],
            },
        ]
    )

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=False)

    assert report.counters_examined == 0
    assert report.changes == []
    assert report.missing_counters == [(RICE, Decimal(50))]


async def test_seeded_counter_is_not_reported_as_missing(db: None) -> None:
    await _seed()
    couch = _couch_stub(
        [
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "50"}],
            },
        ]
    )

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=False)

    assert report.missing_counters == []


# --- qty_target realignment (--targets) ---
#
# `seed_counter` writes qty_target with `$setOnInsert` so a CDC event can never move a
# live ceiling (CR-060 FR-2). The consequence, spelled out in CR-060's decision log, is
# that editing a campaign target leaves the counter behind: the board and public_needs
# recompute to the new figure while donors keep being refused NEED_FULL at the old one.
# CR-060 §Change names this tool as the thing allowed to close that gap.


def _campaign(qty_target: str, *, status: str = "open", item_id: str = "item:rice"):
    return {
        "_id": CAMPAIGN,
        "type": "donation_campaign",
        "status": status,
        "needs": [{"item_id": item_id, "qty_target": qty_target}],
    }


async def _target(item_id: str = "item:rice") -> Decimal:
    counter = await DonationNeedCounter.find_one(
        DonationNeedCounter.shelter_code == SHELTER,
        DonationNeedCounter.item_id == item_id,
    )
    assert counter is not None
    return counter.qty_target


async def test_targets_off_leaves_a_drifted_ceiling_alone(db: None) -> None:
    """The default stays CR-060 FR-2 behaviour — opt in or nothing moves."""
    await _seed(qty_target="12")
    couch = _couch_stub([_campaign("9989")])

    report = await reconcile_shelter(couch, SHELTER, now=datetime.now(UTC), apply=True)

    assert report.target_changes == []
    assert await _target() == Decimal(12)


async def test_targets_dry_run_reports_but_writes_nothing(db: None) -> None:
    await _seed(qty_target="12")
    couch = _couch_stub([_campaign("9989")])

    report = await reconcile_shelter(
        couch, SHELTER, now=datetime.now(UTC), apply=False, targets=True
    )

    assert report.target_changes == [(RICE, Decimal(12), Decimal(9989))]
    assert report.targets_changed == 0
    assert await _target() == Decimal(12)


async def test_targets_apply_raises_the_ceiling_to_the_campaign(db: None) -> None:
    await _seed(qty_target="12")
    couch = _couch_stub([_campaign("9989")])

    report = await reconcile_shelter(
        couch, SHELTER, now=datetime.now(UTC), apply=True, targets=True
    )

    assert report.targets_changed == 1
    assert await _target() == Decimal(9989)


async def test_targets_lowers_a_ceiling_when_nothing_is_reserved(db: None) -> None:
    await _seed(qty_target="500")
    couch = _couch_stub([_campaign("100")])

    await reconcile_shelter(
        couch, SHELTER, now=datetime.now(UTC), apply=True, targets=True
    )

    assert await _target() == Decimal(100)


async def test_targets_refuses_to_strand_quota_donors_already_hold(db: None) -> None:
    """Bookings accepted under the old ceiling are still owed — never orphan them."""
    await _seed(qty_target="500")
    couch = _couch_stub(
        [
            _campaign("10"),
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "80"}],
            },
        ]
    )

    report = await reconcile_shelter(
        couch, SHELTER, now=datetime.now(UTC), apply=True, targets=True
    )

    assert report.target_refused == [(RICE, Decimal(500), Decimal(10))]
    assert report.target_changes == []
    assert await _target() == Decimal(500)


async def test_targets_skips_closed_campaigns(db: None) -> None:
    """CR-060 FR-4 — a closed campaign's counter keeps the ceiling it was seeded with."""
    await _seed(qty_target="50")
    couch = _couch_stub([_campaign("9999", status="closed")])

    report = await reconcile_shelter(
        couch, SHELTER, now=datetime.now(UTC), apply=True, targets=True
    )

    assert report.target_changes == []
    assert await _target() == Decimal(50)


async def test_targets_leaves_a_counter_with_no_open_campaign_alone(db: None) -> None:
    await _seed(qty_target="50")
    couch = _couch_stub([])

    report = await reconcile_shelter(
        couch, SHELTER, now=datetime.now(UTC), apply=True, targets=True
    )

    assert report.target_changes == []
    assert await _target() == Decimal(50)


async def test_targets_is_idempotent(db: None) -> None:
    await _seed(qty_target="12")
    couch = _couch_stub([_campaign("9989")])
    now = datetime.now(UTC)

    await reconcile_shelter(couch, SHELTER, now=now, apply=True, targets=True)
    second = await reconcile_shelter(couch, SHELTER, now=now, apply=True, targets=True)

    assert second.target_changes == []
    assert await _target() == Decimal(9989)


async def test_shelved_goods_leave_the_whole_remainder_bookable(db: None) -> None:
    """End to end on the counter: target 100, 11 received and keyed → 89 bookable."""
    await _seed("100")
    couch = _couch_stub(
        [
            {
                "_id": "donation:1",
                "type": "donation",
                "campaign_id": CAMPAIGN,
                "status": "received",
                "items": [{"item_id": "item:rice", "qty": "11"}],
            },
            _ledger("donation:1", "11"),
        ]
    )
    now = datetime.now(UTC)
    # The state the bug left behind: the booking still reserved, and on the shelf.
    await DonationNeedCounter.get_pymongo_collection().update_one(
        {"shelter_code": SHELTER}, {"$set": {"reserved_qty": bson.Decimal128("11")}}
    )
    await set_on_hand_qty(
        shelter_code=SHELTER, item_id="item:rice", qty=Decimal(11), now=now
    )

    async def book(qty: str) -> ReserveResult:
        return await reserve_quota(
            shelter_code=SHELTER,
            campaign_id=CAMPAIGN,
            item_id="item:rice",
            qty=Decimal(qty),
            now=now,
        )

    assert await book("89") is ReserveResult.NEED_FULL

    report = await reconcile_shelter(couch, SHELTER, now=now, apply=True)

    assert report.counters_changed == 1
    assert await _reserved() == Decimal(0)
    assert await book("90") is ReserveResult.NEED_FULL
    assert await book("89") is ReserveResult.RESERVED
