"""Tests for retention helpers."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from tent_model import (
    DonationBuffer,
    DonationNeedCounter,
    DonationSlotCounter,
    DonorBuffer,
    PublicShelter,
    RetentionAudit,
    ShelterStock,
)

from worker.projectors.compute_needs import compute_needs
from worker.retention.job import (
    classify_expired_buffer,
    purge_expired_buffers,
    reconcile_closed_shelters,
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
        classify_expired_buffer(synced_to_couch=False, expires_at=expired, now=now)
        == "stuck"
    )
    assert (
        classify_expired_buffer(synced_to_couch=True, expires_at=expired, now=now)
        == "purge"
    )
    assert (
        classify_expired_buffer(
            synced_to_couch=True, expires_at=now + timedelta(hours=1), now=now
        )
        == "keep"
    )
    assert (
        classify_expired_buffer(synced_to_couch=False, expires_at=None, now=now)
        == "keep"
    )


async def test_purge_releases_quota_for_timed_out_declared_buffer(db: None) -> None:
    now = datetime.now(UTC)
    counter_id = "SH001:donation_campaign:c1:item:rice"
    await DonationNeedCounter(
        id=counter_id,
        shelter_code="SH001",
        campaign_id="donation_campaign:c1",
        item_id="item:rice",
        qty_target=Decimal(10),
        reserved_qty=Decimal(4),
        created_at=now,
        updated_at=now,
    ).insert()
    await DonationBuffer(
        id="donation:01TESTEXPIRED0000000001",
        shelter_code="SH001",
        donor=DonorBuffer(name="Timeout Donor", phone="0810000001"),
        items_declared=[
            {
                "item_id": "item:rice",
                "free_text": "ข้าวสาร",
                "qty": 4,
                "unit": "kg",
                "reserved_qty": "4",
            }
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
    assert counter.reserved_qty == Decimal(0), (
        "timed-out declared reservation must release its quota"
    )
    assert await DonationBuffer.get("donation:01TESTEXPIRED0000000001") is None


async def test_purge_removes_the_vehicle_plate_with_the_buffer(db: None) -> None:
    # the plate lives only in `logistics`; the buffer is purged whole.
    now = datetime.now(UTC)
    await DonationBuffer(
        id="donation:01TESTPLATE00000000001",
        shelter_code="SH001",
        donor=DonorBuffer(name="Plate Donor", phone="0810000002"),
        items_declared=[],
        logistics={
            "delivery_method": "self_dropoff",
            "vehicle": "car",
            "vehicle_plate": "กข 1234",
        },
        campaign_id=None,
        booking_ref="DN-600002",
        tracking_token="TX-SH001-PLATE0001",
        tracking_token_hash="hash-plate-001",
        status="received",
        synced_to_couch=True,
        created_at=now - timedelta(hours=80),
        expires_at=now - timedelta(hours=8),
    ).insert()

    await purge_expired_buffers("test-run-plate")

    assert await DonationBuffer.get("donation:01TESTPLATE00000000001") is None


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
        qty_target=Decimal(10),
        reserved_qty=Decimal(4),
        created_at=now,
        updated_at=now,
    ).insert()
    await DonationBuffer(
        id="donation:01TESTRECEIVED000000001",
        shelter_code="SH001",
        donor=DonorBuffer(name="Received Donor", phone="0810000002"),
        items_declared=[
            {
                "item_id": "item:rice",
                "free_text": "ข้าวสาร",
                "qty": 4,
                "unit": "kg",
                "reserved_qty": "4",
            }
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
    assert counter.reserved_qty == Decimal(4), (
        "received donations keep their quota consumed"
    )


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


async def test_purge_frees_the_place_of_a_timed_out_booking(db: None) -> None:
    """A capped window does not stay full for a donor who never came."""
    now = datetime.now(UTC)
    slot = "SH001:pickup:2026-06-27:10:00"
    await DonationSlotCounter(
        id=slot, booked=1, created_at=now, updated_at=now
    ).insert()
    await DonationBuffer(
        id="donation:01TESTSLOTEXPIRED0000001",
        shelter_code="SH001",
        donor=DonorBuffer(name="Timeout Donor", phone="0810000009"),
        items_declared=[{"free_text": "ข้าวสาร", "qty": 1, "unit": "kg"}],
        slot_counter_id=slot,
        booking_ref="DN-600009",
        tracking_token="TX-SH001-SLOTEXP001",
        tracking_token_hash="hash-slot-expired-001",
        status="pending_review",
        synced_to_couch=True,
        created_at=now - timedelta(hours=80),
        expires_at=now - timedelta(hours=8),
    ).insert()

    await purge_expired_buffers("test-run-slot")

    counter = await DonationSlotCounter.get(slot)
    assert counter is not None
    assert counter.booked == 0


async def test_reconcile_closed_shelters_audit_deletes_their_stock_rows(
    db: None,
) -> None:
    """`shelter_stocks` is keyed by shelter_code like needs — a closed shelter's rows go
    with it, audited, while an open shelter's rows stay (#461)."""
    now = datetime.now(UTC)
    for code, status in (("SH940", "closed"), ("SH941", "open")):
        await PublicShelter(
            id=code,
            shelter_code=code,
            name=f"ศูนย์ {code}",
            status=status,
            capacity=10,
            updated_at=now,
        ).insert()
        await ShelterStock(
            id=f"{code}:item_master:rice",
            shelter_code=code,
            item_id="item_master:rice",
            name_th="ข้าวสาร",
            type_code="food",
            unit_label="กก.",
            updated_at=now,
        ).insert()

    await reconcile_closed_shelters("test-run-stock")

    assert await PublicShelter.get("SH940") is None
    assert await ShelterStock.get("SH940:item_master:rice") is None
    assert await PublicShelter.get("SH941") is not None
    assert await ShelterStock.get("SH941:item_master:rice") is not None
    audits = await RetentionAudit.find(
        RetentionAudit.target_collection == "shelter_stocks"
    ).to_list()
    assert [a.target_id for a in audits] == ["SH940:item_master:rice"]
    assert audits[0].status == "verified"
