"""Quota settles off the CouchDB status, not the intake buffer's TTL.

Regression cover for two leaks that shared one root cause: ``DonationBuffer.status`` was
written only by FastAPI's pre-inbound ``cancel()``, so once inbound synced a donation the
buffer froze at ``declared`` while CouchDB moved on.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from tent_model import (
    DonationBuffer,
    DonationNeedCounter,
    DonorBuffer,
    counter_id,
    reserve_quota,
    seed_counter,
)

from worker.quota.settle import settle_donation_quota

SHELTER = "SH001"
CAMPAIGN = "donation_campaign:01"
TOKEN_HASH = "hash-settle"
DONATION_ID = "donation:1"


async def _seed(qty_target: str = "50") -> None:
    await seed_counter(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty_target=Decimal(qty_target),
        now=datetime.now(UTC),
    )


async def _reserved() -> Decimal:
    counter = await DonationNeedCounter.get(counter_id(SHELTER, CAMPAIGN, "item:rice"))
    assert counter is not None
    return counter.reserved_qty


async def _buffer(
    status: str = "declared",
    *,
    campaign_id: str | None = CAMPAIGN,
    reserved_qty: str | None = "6",
) -> DonationBuffer:
    now = datetime.now(UTC)
    item: dict = {"item_id": "item:rice", "qty": "6"}
    if reserved_qty is not None:
        item["reserved_qty"] = reserved_qty
    return await DonationBuffer(
        id=DONATION_ID,
        shelter_code=SHELTER,
        donor=DonorBuffer(name="ก", phone="0810000000"),
        items_declared=[item],
        campaign_id=campaign_id,
        booking_ref="DN-000001",
        tracking_token="TX-SH001-AAAAAAAA",
        tracking_token_hash=TOKEN_HASH,
        status=status,
        synced_to_couch=True,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()


def _doc(status: str, *, token_hash: str | None = TOKEN_HASH) -> dict:
    doc: dict = {"_id": DONATION_ID, "type": "donation", "status": status}
    if token_hash is not None:
        doc["tracking_token_hash"] = token_hash
    return doc


async def _current_status() -> str:
    buffer = await DonationBuffer.get(DONATION_ID)
    assert buffer is not None
    return buffer.status


async def test_cancel_after_sync_releases_quota(db: None) -> None:
    """The BFF cancels straight in CouchDB — quota must come back without FastAPI."""
    await _seed()
    await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("6"),
        now=datetime.now(UTC),
    )
    await _buffer()

    released = await settle_donation_quota(_doc("cancelled"), now=datetime.now(UTC))

    assert released == Decimal("6")
    assert await _reserved() == Decimal("0")
    assert await _current_status() == "cancelled"


async def test_replaying_the_same_change_does_not_release_twice(db: None) -> None:
    """The counter is an unconditional $inc — a double release reopens a full need."""
    await _seed()
    await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("10"),
        now=datetime.now(UTC),
    )
    await _buffer()

    now = datetime.now(UTC)
    await settle_donation_quota(_doc("cancelled"), now=now)
    released_again = await settle_donation_quota(_doc("cancelled"), now=now)

    assert released_again == Decimal("0")
    # 10 reserved − 6 released once. A second release would have left 0 and let four
    # more units of rice be booked against a target that is already spoken for.
    assert await _reserved() == Decimal("4")


async def test_receiving_keeps_the_quota_but_updates_the_buffer(db: None) -> None:
    """The second leak: a received donation used to stay "declared" and get released
    by the TTL purge, handing out target that was already sitting in the shelter."""
    await _seed()
    await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("6"),
        now=datetime.now(UTC),
    )
    await _buffer()

    released = await settle_donation_quota(_doc("received"), now=datetime.now(UTC))

    assert released == Decimal("0")
    assert await _reserved() == Decimal("6")
    # purge_expired_buffers releases only for "declared" — this is what makes it skip.
    assert await _current_status() == "received"


async def test_cancelling_a_received_donation_releases(db: None) -> None:
    await _seed()
    await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("6"),
        now=datetime.now(UTC),
    )
    await _buffer(status="received")

    released = await settle_donation_quota(_doc("cancelled"), now=datetime.now(UTC))

    assert released == Decimal("6")
    assert await _reserved() == Decimal("0")


async def test_expiring_releases(db: None) -> None:
    """expire_declared_donations flips the doc; the flip comes back round the feed."""
    await _seed()
    await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("6"),
        now=datetime.now(UTC),
    )
    await _buffer()

    assert await settle_donation_quota(_doc("expired"), now=datetime.now(UTC)) == Decimal("6")
    assert await _reserved() == Decimal("0")


async def test_purged_buffer_is_not_released_again(db: None) -> None:
    """Retention deleted the row after releasing — nothing left to hand back."""
    await _seed()
    await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal("6"),
        now=datetime.now(UTC),
    )

    assert await settle_donation_quota(_doc("cancelled"), now=datetime.now(UTC)) == Decimal("0")
    assert await _reserved() == Decimal("6")


async def test_staff_walk_in_donation_is_ignored(db: None) -> None:
    """No tracking token means it never reserved through the public path."""
    await _seed()
    assert await settle_donation_quota(
        _doc("cancelled", token_hash=None), now=datetime.now(UTC)
    ) == Decimal("0")


async def test_item_without_reserved_qty_is_skipped(db: None) -> None:
    """Booked before CR-047, or free-text — it never took a counter."""
    await _seed()
    await _buffer(reserved_qty=None)

    assert await settle_donation_quota(_doc("cancelled"), now=datetime.now(UTC)) == Decimal("0")
    assert await _current_status() == "cancelled"


async def test_donation_outside_any_campaign_is_skipped(db: None) -> None:
    await _seed()
    await _buffer(campaign_id=None)

    assert await settle_donation_quota(_doc("cancelled"), now=datetime.now(UTC)) == Decimal("0")
    assert await _current_status() == "cancelled"


async def test_missing_status_leaves_the_buffer_alone(db: None) -> None:
    await _seed()
    await _buffer()

    malformed = {"_id": DONATION_ID, "type": "donation", "tracking_token_hash": TOKEN_HASH}
    assert await settle_donation_quota(malformed, now=datetime.now(UTC)) == Decimal("0")
    # Never write a null status onto the buffer — the guards downstream read it.
    assert await _current_status() == "declared"


# --- walk-in donations must hold quota too ---


def _walk_in(**overrides) -> dict:
    doc = {
        "_id": "donation:walkin",
        "type": "donation",
        "status": "declared",
        "channel": "walk_in",
        "tracking_token_hash": "hash-walkin",
        "campaign_id": CAMPAIGN,
        "items": [{"item_id": "item:rice", "qty": "40"}],
    }
    doc.update(overrides)
    return doc


async def _reconcile_calls(doc: dict) -> list:
    """Run reserve_walk_in_quota with reconcile stubbed; return the calls it made."""
    from unittest.mock import AsyncMock, patch

    from worker.quota.reconcile import ShelterReconcileReport
    from worker.quota.settle import reserve_walk_in_quota

    with patch(
        "worker.quota.settle.reconcile_shelter",
        new_callable=AsyncMock,
        return_value=ShelterReconcileReport(shelter_code=SHELTER),
    ) as reconcile:
        ran = await reserve_walk_in_quota(
            AsyncMock(), doc, shelter_code=SHELTER, now=datetime.now(UTC)
        )
    return [ran, reconcile.await_count]


async def test_walk_in_donation_is_counted(db: None) -> None:
    ran, calls = await _reconcile_calls(_walk_in())
    assert ran is True
    assert calls == 1


async def test_a_public_booking_is_left_alone(db: None) -> None:
    """FastAPI already incremented on the way in — counting it here doubles it.

    Note it is `channel`, not the token hash, that tells them apart: staff walk-ins
    carry a tracking token too, so donors get a ticket either way.
    """
    ran, calls = await _reconcile_calls(_walk_in(channel="public"))
    assert ran is False
    assert calls == 0


async def test_a_walk_in_outside_any_campaign_holds_nothing(db: None) -> None:
    ran, calls = await _reconcile_calls(_walk_in(campaign_id=None))
    assert ran is False
    assert calls == 0


async def test_free_text_only_walk_in_holds_nothing(db: None) -> None:
    """No item_id means no counter to attribute it to."""
    ran, calls = await _reconcile_calls(_walk_in(items=[{"free_text": "ข้าวสาร", "qty": "5"}]))
    assert ran is False
    assert calls == 0


async def test_a_settled_walk_in_is_not_counted(db: None) -> None:
    for status in ("cancelled", "expired", "rejected", "redirected"):
        ran, calls = await _reconcile_calls(_walk_in(status=status))
        assert ran is False, status
        assert calls == 0, status


async def test_a_received_walk_in_still_counts(db: None) -> None:
    """Goods in hand consume the target just as a pledge does (CR-061)."""
    ran, _ = await _reconcile_calls(_walk_in(status="received"))
    assert ran is True
