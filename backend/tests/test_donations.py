"""Donations create + tracking tests."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from tent_model.donation_buffer import DonationBuffer, DonorBuffer
from tent_model.donation_need_counter import DonationNeedCounter
from tent_model.donation_need_counter_ops import release_quota, reserve_quota
from tent_model.public_donation import PublicDonation
from tent_model.public_shelter import PublicShelter

from apiapp.core.config import Settings
from apiapp.modules.donations import router as donation_router
from apiapp.modules.donations import use_case as donation_use_case
from apiapp.utils.masking import sha256_hex
from apiapp.utils.ulid import new_ulid


@pytest.fixture
def auth_headers(settings: Settings) -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.EXTERNAL_API_SECRET}"}


@pytest.fixture
async def open_shelter() -> PublicShelter:
    shelter = PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="Test Shelter",
        status="open",
        capacity=100,
        updated_at=datetime.now(UTC),
    )
    await shelter.insert()
    return shelter


async def test_create_donation_requires_bearer(
    client: AsyncClient, open_shelter: PublicShelter
) -> None:
    response = await client.post(
        "/public/v1/donations",
        json={
            "shelter_code": "SH001",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [],
        },
    )
    assert response.status_code == 401


async def test_create_donation_persists_campaign_id_and_tracking_stub(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "campaign_id": "donation_campaign:c1",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [
                {
                    "item_id": "item:rice",
                    "free_text": "ข้าวสาร",
                    "qty": 5,
                    "unit": "kg",
                }
            ],
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    token = body["tracking_token"]
    booking_ref = body["booking_ref"]
    assert token.startswith("TX-SH001-")
    # TX-SH001- + 32 hex chars from token_hex(16)
    assert len(token.removeprefix("TX-SH001-")) == 32
    assert booking_ref.startswith("DN-")

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.campaign_id == "donation_campaign:c1"
    assert buffer.id.startswith("donation:")
    assert len(buffer.id.removeprefix("donation:")) == 26

    stub = await PublicDonation.find_one(PublicDonation.tracking_token_hash == sha256_hex(token))
    assert stub is not None
    assert stub.booking_ref == booking_ref
    assert stub.status == "declared"

    track = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)
    assert track.status_code == 200
    tracked = track.json()
    assert tracked["donation"]["booking_ref"] == booking_ref
    assert tracked["donation"]["status"] == "declared"
    assert tracked["donation"]["items"][0]["item_name"] == "ข้าวสาร"
    assert tracked["donation"]["donor"]["name"] == "Donor"
    assert tracked["donation"]["donor"]["phone_masked"] == "***-***-5678"
    assert tracked["donation"]["expires_at"] is not None


async def test_create_donation_rejects_unknown_shelter(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """No such shelter in `public_shelters` → 404, distinct from a closed one."""
    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH999",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"item_id": "item:rice", "qty": 1, "unit": "kg"}],
        },
    )
    assert response.status_code == 404
    assert response.json()["errors"][0]["error"] == "SHELTER_NOT_FOUND"


async def test_create_donation_rejects_closed_shelter(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A shelter that exists but stopped intake answers 409, not 404."""
    shelter = PublicShelter(
        id="SH002",
        shelter_code="SH002",
        name="Closed Shelter",
        status="closed",
        capacity=50,
        updated_at=datetime.now(UTC),
    )
    await shelter.insert()

    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH002",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"item_id": "item:rice", "qty": 1, "unit": "kg"}],
        },
    )
    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "SHELTER_CLOSED"


async def test_get_tracking_falls_back_to_buffer(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-FALLBACK1"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Legacy", phone="0899999999"),
        items_declared=[{"free_text": "น้ำดื่ม", "qty": 2, "unit": "pack"}],
        campaign_id=None,
        booking_ref="DN-999001",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    track = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)
    assert track.status_code == 200
    body = track.json()
    assert body["donation"]["booking_ref"] == "DN-999001"
    assert body["donation"]["items"][0]["item_name"] == "น้ำดื่ม"


async def test_track_search_resolves_dn_plus_phone(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-SEARCH001"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Search Donor", phone="081-234-5678"),
        items_declared=[{"free_text": "ข้าวสาร", "qty": 1, "unit": "kg"}],
        campaign_id=None,
        booking_ref="DN-905176",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    ok = await client.post(
        "/public/v1/donations/track-search",
        headers=auth_headers,
        json={"booking_ref": "dn-905176", "phone": "0812345678"},
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["tracking_token"] == token
    assert body["booking_ref"] == "DN-905176"

    bad_phone = await client.post(
        "/public/v1/donations/track-search",
        headers=auth_headers,
        json={"booking_ref": "DN-905176", "phone": "0899999999"},
    )
    assert bad_phone.status_code == 404


async def test_patch_courier_updates_unsynced_buffer(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-PATCH001"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Parcel Donor", phone="0811111111"),
        items_declared=[{"free_text": "ผ้าห่ม", "qty": 1, "unit": "pcs"}],
        logistics={"delivery_method": "parcel", "courier_tracking_no": None},
        campaign_id=None,
        booking_ref="DN-888001",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    response = await client.patch(
        f"/public/v1/donations/{token}",
        headers=auth_headers,
        json={"courier_tracking_no": "TH123456789TH"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
    assert buffer is not None
    assert buffer.logistics is not None
    assert buffer.logistics["courier_tracking_no"] == "TH123456789TH"


async def test_patch_courier_rejects_already_synced_buffer(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-PATCH002"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Synced", phone="0822222222"),
        items_declared=[],
        logistics={"delivery_method": "parcel"},
        campaign_id=None,
        booking_ref="DN-888002",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="declared",
        synced_to_couch=True,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    response = await client.patch(
        f"/public/v1/donations/{token}",
        headers=auth_headers,
        json={"courier_tracking_no": "TH999"},
    )
    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "SYNCED_TO_COUCH"


async def test_cancel_updates_unsynced_buffer_and_stub(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-CANCEL001"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Cancel Donor", phone="0833333333"),
        items_declared=[{"free_text": "ผ้าห่ม", "qty": 1, "unit": "pcs"}],
        campaign_id=None,
        booking_ref="DN-777001",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()
    await PublicDonation(
        id=f"donation:{new_ulid()}",
        tracking_token_hash=token_hash,
        shelter_code="SH001",
        status="declared",
        booking_ref="DN-777001",
        items_declared=[],
        received_summary=None,
        updated_at=now,
    ).insert()

    response = await client.delete(f"/public/v1/donations/{token}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["success"] is True

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
    assert buffer is not None
    assert buffer.status == "cancelled"

    stub = await PublicDonation.find_one(PublicDonation.tracking_token_hash == token_hash)
    assert stub is not None
    assert stub.status == "cancelled"

    track = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)
    assert track.json()["donation"]["status"] == "cancelled"


async def test_cancel_rejects_already_synced_buffer(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-CANCEL002"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Synced", phone="0844444444"),
        items_declared=[],
        campaign_id=None,
        booking_ref="DN-777002",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="declared",
        synced_to_couch=True,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    response = await client.delete(f"/public/v1/donations/{token}", headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "SYNCED_TO_COUCH"


async def test_cancel_rejects_non_declared_status(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-CANCEL003"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Received", phone="0855555555"),
        items_declared=[],
        campaign_id=None,
        booking_ref="DN-777003",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="received",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    response = await client.delete(f"/public/v1/donations/{token}", headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["errors"][0]["success"] is False


async def test_cancel_releases_reserved_quota(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-CANCEL004"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    counter_id = "SH001:donation_campaign:c4:item:rice"
    await DonationNeedCounter(
        id=counter_id,
        shelter_code="SH001",
        campaign_id="donation_campaign:c4",
        item_id="item:rice",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("6"),
        created_at=now,
        updated_at=now,
    ).insert()
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Cancel Donor", phone="0833333333"),
        items_declared=[
            {"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 4, "unit": "kg", "reserved_qty": "4"}
        ],
        campaign_id="donation_campaign:c4",
        booking_ref="DN-777004",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    response = await client.delete(f"/public/v1/donations/{token}", headers=auth_headers)
    assert response.status_code == 200

    counter = await DonationNeedCounter.get(counter_id)
    assert counter is not None
    assert counter.reserved_qty == Decimal("2")


async def test_cancel_twice_does_not_underflow_quota(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Double-cancel race (same buffer processed twice) must not drive reserved_qty below 0."""
    token = "TX-SH001-CANCEL005"
    token_hash = sha256_hex(token)
    now = datetime.now(UTC)
    counter_id = "SH001:donation_campaign:c5:item:rice"
    await DonationNeedCounter(
        id=counter_id,
        shelter_code="SH001",
        campaign_id="donation_campaign:c5",
        item_id="item:rice",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("4"),
        created_at=now,
        updated_at=now,
    ).insert()
    buffer_id = f"donation:{new_ulid()}"
    await DonationBuffer(
        id=buffer_id,
        shelter_code="SH001",
        donor=DonorBuffer(name="Cancel Donor", phone="0833333333"),
        items_declared=[
            {"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 4, "unit": "kg", "reserved_qty": "4"}
        ],
        campaign_id="donation_campaign:c5",
        booking_ref="DN-777005",
        tracking_token=token,
        tracking_token_hash=token_hash,
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    first = await client.delete(f"/public/v1/donations/{token}", headers=auth_headers)
    assert first.status_code == 200

    # simulate a second concurrent cancel racing in before the buffer status
    # transition is visible — release_quota's own underflow guard is what protects
    # reserved_qty here, so call it directly the way the retry path would.
    await release_quota(
        shelter_code="SH001", campaign_id="donation_campaign:c5", item_id="item:rice",
        qty=Decimal("4"), now=datetime.now(UTC),
    )

    counter = await DonationNeedCounter.get(counter_id)
    assert counter is not None
    assert counter.reserved_qty == Decimal("0"), "must clamp at 0, never go negative"


async def test_cancel_missing_donation_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.delete(
        "/public/v1/donations/TX-SH001-NOPE0000", headers=auth_headers
    )
    assert response.status_code == 404


async def test_new_ulid_shape() -> None:
    value = new_ulid()
    assert len(value) == 26
    assert value.isalnum()
    assert value == value.upper()


async def test_create_donation_reserves_quota_atomically(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    now = datetime.now(UTC)
    await DonationNeedCounter(
        id="SH001:donation_campaign:c1:item:rice",
        shelter_code="SH001",
        campaign_id="donation_campaign:c1",
        item_id="item:rice",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("3"),
        created_at=now,
        updated_at=now,
    ).insert()

    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "campaign_id": "donation_campaign:c1",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 5, "unit": "kg"}],
        },
    )
    assert response.status_code == 201
    token = response.json()["tracking_token"]

    counter = await DonationNeedCounter.get("SH001:donation_campaign:c1:item:rice")
    assert counter is not None
    assert counter.reserved_qty == Decimal("8")

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.items_declared[0]["reserved_qty"] == "5"


async def test_create_donation_rejects_when_over_quota(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    now = datetime.now(UTC)
    await DonationNeedCounter(
        id="SH001:donation_campaign:c2:item:water",
        shelter_code="SH001",
        campaign_id="donation_campaign:c2",
        item_id="item:water",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("9"),
        created_at=now,
        updated_at=now,
    ).insert()

    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "campaign_id": "donation_campaign:c2",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"item_id": "item:water", "free_text": "น้ำดื่ม", "qty": 5, "unit": "pack"}],
        },
    )
    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "NEED_FULL"

    counter = await DonationNeedCounter.get("SH001:donation_campaign:c2:item:water")
    assert counter is not None
    assert counter.reserved_qty == Decimal("9"), "rejected reserve must not mutate the counter"

    buffer_count = await DonationBuffer.find(
        DonationBuffer.shelter_code == "SH001", DonationBuffer.campaign_id == "donation_campaign:c2"
    ).count()
    assert buffer_count == 0, "no buffer should be created when a quota-checked item is rejected"


async def test_create_donation_compensates_earlier_item_on_partial_reject(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    now = datetime.now(UTC)
    await DonationNeedCounter(
        id="SH001:donation_campaign:c3:item:rice",
        shelter_code="SH001",
        campaign_id="donation_campaign:c3",
        item_id="item:rice",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("0"),
        created_at=now,
        updated_at=now,
    ).insert()
    await DonationNeedCounter(
        id="SH001:donation_campaign:c3:item:water",
        shelter_code="SH001",
        campaign_id="donation_campaign:c3",
        item_id="item:water",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("10"),
        created_at=now,
        updated_at=now,
    ).insert()

    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "campaign_id": "donation_campaign:c3",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [
                {"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 4, "unit": "kg"},
                {"item_id": "item:water", "free_text": "น้ำดื่ม", "qty": 1, "unit": "pack"},
            ],
        },
    )
    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "NEED_FULL"

    rice_counter = await DonationNeedCounter.get("SH001:donation_campaign:c3:item:rice")
    assert rice_counter is not None
    assert rice_counter.reserved_qty == Decimal("0"), (
        "item reserved earlier in the same request must be compensated back "
        "when a later item in the same submission is rejected"
    )
    water_counter = await DonationNeedCounter.get("SH001:donation_campaign:c3:item:water")
    assert water_counter is not None
    assert water_counter.reserved_qty == Decimal("10")


async def test_create_donation_allows_unseeded_quota_key(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """No DonationNeedCounter doc yet (worker projector not caught up — CR-048) → fail-open."""
    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "campaign_id": "donation_campaign:unseeded",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"item_id": "item:unknown", "free_text": "อื่นๆ", "qty": 1, "unit": "pcs"}],
        },
    )
    assert response.status_code == 201
    counter = await DonationNeedCounter.get("SH001:donation_campaign:unseeded:item:unknown")
    assert counter is None


async def test_concurrent_bookings_never_exceed_the_target(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """T-21 DoD — race ระหว่างจองพร้อมกัน, end to end through the HTTP route.

    Twelve donors submit at once for a target of 10 with 2 per booking: exactly five may
    be created. Asserts the aggregate rather than which ones win, so the interleaving
    can vary without making the test flaky. The pre-counter read-then-write path would
    have accepted all twelve.
    """
    # The router's sliding window is module state shared across tests in this process,
    # and twelve requests at once would otherwise be judged against whatever earlier
    # tests already spent. Rate limiting has its own test; this one is about the quota.
    donation_router._rate_buckets.clear()

    now = datetime.now(UTC)
    await DonationNeedCounter(
        id="SH001:donation_campaign:race:item:rice",
        shelter_code="SH001",
        campaign_id="donation_campaign:race",
        item_id="item:rice",
        qty_target=Decimal("10"),
        reserved_qty=Decimal("0"),
        created_at=now,
        updated_at=now,
    ).insert()

    def booking(index: int):
        return client.post(
            "/public/v1/donations",
            headers=auth_headers,
            json={
                "shelter_code": "SH001",
                "campaign_id": "donation_campaign:race",
                "donor": {"name": f"Donor {index}", "phone": "0812345678"},
                "items": [
                    {"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 2, "unit": "kg"}
                ],
            },
        )

    responses = await asyncio.gather(*[booking(i) for i in range(12)])

    created = [r for r in responses if r.status_code == 201]
    rejected = [r for r in responses if r.status_code == 409]
    assert len(created) == 5, [r.status_code for r in responses]
    assert len(rejected) == 7
    assert all(r.json()["errors"][0]["error"] == "NEED_FULL" for r in rejected)

    counter = await DonationNeedCounter.get("SH001:donation_campaign:race:item:rice")
    assert counter is not None
    assert counter.reserved_qty == Decimal("10")

    # A rejected booking must not leave a staging row behind holding no quota.
    buffers = await DonationBuffer.find(
        DonationBuffer.campaign_id == "donation_campaign:race"
    ).to_list()
    assert len(buffers) == 5


async def test_patch_courier_rejects_cancelled_buffer(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """A donor must not keep editing a booking they already cancelled."""
    token = "TX-SH001-CANCELLED"
    now = datetime.now(UTC)
    await DonationBuffer(
        id="donation:cancelled-courier",
        shelter_code="SH001",
        donor=DonorBuffer(name="Donor", phone="0812345678"),
        items_declared=[{"item_id": "item:rice", "qty": "1", "unit": "kg"}],
        logistics={"delivery_method": "parcel"},
        booking_ref="DN-900001",
        tracking_token=token,
        tracking_token_hash=sha256_hex(token),
        status="cancelled",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()

    response = await client.patch(
        f"/public/v1/donations/{token}",
        headers=auth_headers,
        json={"courier_tracking_no": "TH123456789"},
    )

    assert response.status_code == 400
    assert "cancelled" in response.json()["errors"][0]["error"]

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert "courier_tracking_no" not in (buffer.logistics or {})


# --- reservation TTL from config:app (schema.md §3.2, T-21 DoD) ---


def test_reservation_expiry_uses_the_supplied_ttl() -> None:
    now = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
    assert donation_use_case.reservation_expiry(now, 24) == now + timedelta(hours=24)


@pytest.mark.parametrize("absent", [None, 0])
def test_reservation_expiry_defaults_to_72_hours(absent: int | None) -> None:
    """An older BFF, or a registry with no config document, must behave as before."""
    now = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
    assert donation_use_case.reservation_expiry(now, absent) == now + timedelta(hours=72)


def test_reservation_expiry_survives_an_out_of_range_ttl() -> None:
    """config:app is staff-authored and unbounded — a fat-fingered value must not 500."""
    now = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
    assert donation_use_case.reservation_expiry(now, 10**18) == now + timedelta(hours=72)


async def _seed_app_config(**fields: object) -> None:
    """Stand in for the worker projecting registry `config:app` into `public_config`."""
    collection = DonationBuffer.get_motor_collection().database["public_config"]
    await collection.replace_one(
        {"_id": "config:app"}, {"_id": "config:app", **fields}, upsert=True
    )


async def _booked_ttl(client: AsyncClient, headers: dict[str, str]) -> timedelta:
    before = datetime.now(UTC)
    response = await client.post(
        "/public/v1/donations",
        headers=headers,
        json={
            "shelter_code": "SH001",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"free_text": "ข้าวสาร", "qty": 5, "unit": "kg"}],
        },
    )
    assert response.status_code == 201
    token = response.json()["tracking_token"]
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    expires_at = buffer.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at - before


async def test_create_donation_honours_the_projected_ttl(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_app_config(donation_reservation_ttl_hours=6)

    # Windowed: "before" is stamped ahead of the request and Mongo truncates to millis.
    assert abs(await _booked_ttl(client, auth_headers) - timedelta(hours=6)) < timedelta(seconds=5)


async def test_create_donation_defaults_when_the_config_has_not_projected_yet(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """A fresh environment has no config document — bookings must still work."""
    assert abs(await _booked_ttl(client, auth_headers) - timedelta(hours=72)) < timedelta(seconds=5)


@pytest.mark.parametrize("bad", [0, -1, "6", 1.5, True, None])
async def test_unusable_configured_ttl_falls_back_to_the_default(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str], bad: object
) -> None:
    """`True` is in here on purpose: bool subclasses int, and would mean "1 hour"."""
    await _seed_app_config(donation_reservation_ttl_hours=bad)

    assert abs(await _booked_ttl(client, auth_headers) - timedelta(hours=72)) < timedelta(seconds=5)


# --- donor edits their own items (CR-080) ---


async def _seed_counter(target: str, item_id: str = "item:rice") -> None:
    from tent_model.donation_need_counter_ops import seed_counter

    await seed_counter(
        shelter_code="SH001",
        campaign_id="donation_campaign:c1",
        item_id=item_id,
        qty_target=Decimal(target),
        now=datetime.now(UTC),
    )


async def _book(client: AsyncClient, headers: dict[str, str], items: list[dict]) -> str:
    # The router's sliding window is module state shared across every test in this
    # process. These cases each make several calls; without clearing, the later ones are
    # judged against what the earlier ones spent and start returning 429. Rate limiting
    # has its own test — these are about editing.
    donation_router._rate_buckets.clear()
    response = await client.post(
        "/public/v1/donations",
        headers=headers,
        json={
            "shelter_code": "SH001",
            "campaign_id": "donation_campaign:c1",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": items,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["tracking_token"]


async def _reserved(item_id: str = "item:rice") -> Decimal:
    counter = await DonationNeedCounter.find_one(
        DonationNeedCounter.shelter_code == "SH001",
        DonationNeedCounter.item_id == item_id,
    )
    assert counter is not None
    return counter.reserved_qty


async def _edit(client: AsyncClient, headers: dict[str, str], token: str, items: list[dict]):
    donation_router._rate_buckets.clear()
    return await client.patch(
        f"/public/v1/donations/{token}/items", headers=headers, json={"items": items}
    )


async def test_raising_a_quantity_reserves_only_the_difference(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "5", "unit": "kg"}])
    assert await _reserved() == Decimal("5")

    assert (
        await _edit(
            client, auth_headers, token, [{"item_id": "item:rice", "qty": "8", "unit": "kg"}]
        )
    ).status_code == 200
    # 8, not 13 — the edit moves the booking, it does not add a second one.
    assert await _reserved() == Decimal("8")


async def test_lowering_a_quantity_gives_the_difference_back(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "40", "unit": "kg"}])

    await _edit(client, auth_headers, token, [{"item_id": "item:rice", "qty": "10", "unit": "kg"}])
    assert await _reserved() == Decimal("10")


async def test_dropping_an_item_releases_all_of_it(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    await _seed_counter("100", "item:water")
    token = await _book(
        client,
        auth_headers,
        [
            {"item_id": "item:rice", "qty": "10", "unit": "kg"},
            {"item_id": "item:water", "qty": "20", "unit": "bottle"},
        ],
    )

    await _edit(client, auth_headers, token, [{"item_id": "item:rice", "qty": "10", "unit": "kg"}])
    assert await _reserved("item:rice") == Decimal("10")
    assert await _reserved("item:water") == Decimal("0")


async def test_moving_quantity_between_items_is_not_blocked_by_itself(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Releases run before reserves, so the booking does not collide with its own hold."""
    await _seed_counter("50")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "50", "unit": "kg"}])
    assert await _reserved() == Decimal("50")

    # The target is exactly full. Swapping 50 for 30 only works if the 50 goes back first.
    assert (
        await _edit(
            client, auth_headers, token, [{"item_id": "item:rice", "qty": "30", "unit": "kg"}]
        )
    ).status_code == 200
    assert await _reserved() == Decimal("30")


async def test_a_full_target_refuses_the_whole_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """CR-080 Q2 — reject the request, leave the booking exactly as it was."""
    await _seed_counter("100")
    await _seed_counter("100", "item:water")
    token = await _book(
        client,
        auth_headers,
        [
            {"item_id": "item:rice", "qty": "10", "unit": "kg"},
            {"item_id": "item:water", "qty": "10", "unit": "bottle"},
        ],
    )
    # Someone else takes the rest of the rice.
    await reserve_quota(
        shelter_code="SH001",
        campaign_id="donation_campaign:c1",
        item_id="item:rice",
        qty=Decimal("90"),
        now=datetime.now(UTC),
    )

    response = await _edit(
        client,
        auth_headers,
        token,
        [
            {"item_id": "item:rice", "qty": "60", "unit": "kg"},
            {"item_id": "item:water", "qty": "5", "unit": "bottle"},
        ],
    )

    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "NEED_FULL"
    # The water release that ran first must have been put back: nothing changed.
    assert await _reserved("item:rice") == Decimal("100")
    assert await _reserved("item:water") == Decimal("10")


async def test_a_refused_edit_leaves_the_items_alone(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("20")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "20", "unit": "kg"}])

    await _edit(client, auth_headers, token, [{"item_id": "item:rice", "qty": "999", "unit": "kg"}])

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.items_declared[0]["qty"] == "20"
    assert buffer.revisions == []


async def test_an_edit_is_logged_as_a_snapshot_pair(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """CR-080 Q4 — the whole basket before and after, not a diff."""
    await _seed_counter("100")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "5", "unit": "kg"}])

    await _edit(client, auth_headers, token, [{"item_id": "item:rice", "qty": "8", "unit": "kg"}])

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert len(buffer.revisions) == 1
    entry = buffer.revisions[0]
    assert entry["by"] == "donor"
    assert entry["items_before"] == [{"item_id": "item:rice", "qty": "5", "unit": "kg"}]
    assert entry["items_after"] == [{"item_id": "item:rice", "qty": "8", "unit": "kg"}]


async def test_editing_repeatedly_appends_and_is_never_capped(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """CR-080 Q5 — no per-booking limit; the IP rate limit is the only brake."""
    await _seed_counter("100")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "1", "unit": "kg"}])

    for qty in ("2", "3", "4"):
        assert (
            await _edit(
                client, auth_headers, token, [{"item_id": "item:rice", "qty": qty, "unit": "kg"}]
            )
        ).status_code == 200

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert len(buffer.revisions) == 3
    assert await _reserved() == Decimal("4")


async def test_editing_does_not_extend_the_ttl(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """CR-080 Q3 — else a donor holds a reservation open forever by editing it."""
    await _seed_counter("100")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "5", "unit": "kg"}])
    token_hash = sha256_hex(token)
    booked = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
    assert booked is not None
    before = booked.expires_at

    await _edit(client, auth_headers, token, [{"item_id": "item:rice", "qty": "6", "unit": "kg"}])

    edited = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
    assert edited is not None
    after = edited.expires_at
    assert after == before


@pytest.mark.parametrize("status_value", ["pending_review", "verifying", "received", "cancelled"])
async def test_only_a_declared_booking_may_be_edited(
    client: AsyncClient,
    open_shelter: PublicShelter,
    auth_headers: dict[str, str],
    status_value: str,
) -> None:
    """CR-080 Q1 — once staff start assessing, the count is theirs."""
    await _seed_counter("100")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "5", "unit": "kg"}])
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    buffer.status = status_value
    await buffer.save()

    response = await _edit(
        client, auth_headers, token, [{"item_id": "item:rice", "qty": "9", "unit": "kg"}]
    )

    assert response.status_code == 400
    assert await _reserved() == Decimal("5")


async def test_an_empty_basket_is_refused(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Cancelling is DELETE. An edit down to nothing would leave a donation of nothing."""
    await _seed_counter("100")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "5", "unit": "kg"}])

    assert (await _edit(client, auth_headers, token, [])).status_code == 400
    assert await _reserved() == Decimal("5")


async def test_editing_an_unknown_token_is_not_found(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    response = await _edit(
        client, auth_headers, "TX-SH001-NOPE", [{"item_id": "item:rice", "qty": "1", "unit": "kg"}]
    )
    assert response.status_code == 404


async def test_tracking_reports_item_id_so_an_edit_can_send_it_back(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The edit form returns the whole basket; it can only return an item_id it was given.

    Dropping it silently untracks the item — the counter releases what it held and never
    retakes it, and the needs board stops deducting it. That happened to a soap donation:
    the first edit lost item:soap, and the public board went on advertising 50 units while
    the back office showed 20.
    """
    await _seed_counter("100", "item:soap")
    token = await _book(
        client, auth_headers, [{"item_id": "item:soap", "qty": "10", "unit": "bar"}]
    )

    tracked = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)

    assert tracked.status_code == 200
    assert tracked.json()["donation"]["items"][0]["item_id"] == "item:soap"


async def test_an_edit_keeps_the_item_quota_tracked(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100", "item:soap")
    token = await _book(
        client, auth_headers, [{"item_id": "item:soap", "qty": "10", "unit": "bar"}]
    )

    await _edit(
        client,
        auth_headers,
        token,
        [{"item_id": "item:soap", "free_text": "สบู่ก้อน", "qty": "30", "unit": "bar"}],
    )

    assert await _reserved("item:soap") == Decimal("30")
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.items_declared[0]["item_id"] == "item:soap"
    assert buffer.items_declared[0]["reserved_qty"] == "30"


async def test_an_edit_that_loses_item_id_does_not_untrack_the_item(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The damage this guards against happened twice to a live soap booking.

    A tracking stub written before DeclaredItem carried item_id handed the edit form a
    bare item; the form sent it back bare; the item stopped being quota-tracked, the
    counter released its 10 and never retook them, and the public board went on
    advertising units the shelter had already been promised.
    """
    await _seed_counter("100", "item:soap")
    # As the donate wizard writes it — item_id plus the name the donor saw.
    token = await _book(
        client,
        auth_headers,
        [{"item_id": "item:soap", "free_text": "สบู่ก้อน", "qty": "10", "unit": "bar"}],
    )

    # Exactly what a stale client sends: the right line, no item_id.
    response = await _edit(
        client, auth_headers, token, [{"free_text": "สบู่ก้อน", "qty": "30", "unit": "bar"}]
    )

    assert response.status_code == 200
    assert await _reserved("item:soap") == Decimal("30")
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.items_declared[0]["item_id"] == "item:soap"


async def test_a_genuinely_new_free_text_line_stays_untracked(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Only lines this booking already holds get an id back — nothing is inferred."""
    await _seed_counter("100", "item:soap")
    token = await _book(
        client, auth_headers, [{"item_id": "item:soap", "qty": "10", "unit": "bar"}]
    )

    await _edit(
        client,
        auth_headers,
        token,
        [
            {"item_id": "item:soap", "free_text": "สบู่ก้อน", "qty": "10", "unit": "bar"},
            {"free_text": "ผ้าอ้อมผู้ใหญ่", "qty": "5", "unit": "แพ็ค"},
        ],
    )

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.items_declared[1].get("item_id") is None
    assert "reserved_qty" not in buffer.items_declared[1]


async def test_dropping_a_line_still_releases_it(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Carrying ids forward must not resurrect a line the donor actually removed."""
    await _seed_counter("100", "item:soap")
    await _seed_counter("100", "item:blanket")
    token = await _book(
        client,
        auth_headers,
        [
            {"item_id": "item:soap", "free_text": "สบู่ก้อน", "qty": "10", "unit": "bar"},
            {"item_id": "item:blanket", "free_text": "ผ้าห่ม", "qty": "4", "unit": "piece"},
        ],
    )

    await _edit(
        client, auth_headers, token, [{"free_text": "สบู่ก้อน", "qty": "10", "unit": "bar"}]
    )

    assert await _reserved("item:soap") == Decimal("10")
    assert await _reserved("item:blanket") == Decimal("0")
