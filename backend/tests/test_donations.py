"""Donations create + tracking tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from tent_model.donation_buffer import DonationBuffer, DonorBuffer
from tent_model.donation_need_counter import DonationNeedCounter
from tent_model.donation_need_counter_ops import release_quota
from tent_model.public_donation import PublicDonation
from tent_model.public_shelter import PublicShelter

from apiapp.core.config import Settings
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
