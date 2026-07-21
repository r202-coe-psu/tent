"""Donations create + tracking tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from tent_model.donation_buffer import DonationBuffer, DonorBuffer
from tent_model.public_donation import PublicDonation
from tent_model.public_shelter import PublicShelter

from apiapp.utils.masking import sha256_hex
from apiapp.utils.ulid import new_ulid


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


async def test_create_donation_persists_campaign_id_and_tracking_stub(
    client: AsyncClient, open_shelter: PublicShelter
) -> None:
    response = await client.post(
        "/public/v1/donations",
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

    track = await client.get(f"/public/v1/donations/{token}")
    assert track.status_code == 200
    tracked = track.json()
    assert tracked["donation"]["booking_ref"] == booking_ref
    assert tracked["donation"]["status"] == "declared"
    assert tracked["donation"]["items"][0]["item_name"] == "ข้าวสาร"


async def test_get_tracking_falls_back_to_buffer(client: AsyncClient) -> None:
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

    track = await client.get(f"/public/v1/donations/{token}")
    assert track.status_code == 200
    body = track.json()
    assert body["donation"]["booking_ref"] == "DN-999001"
    assert body["donation"]["items"][0]["item_name"] == "น้ำดื่ม"


async def test_patch_courier_updates_unsynced_buffer(client: AsyncClient) -> None:
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
        json={"courier_tracking_no": "TH123456789TH"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
    assert buffer is not None
    assert buffer.logistics is not None
    assert buffer.logistics["courier_tracking_no"] == "TH123456789TH"


async def test_patch_courier_rejects_already_synced_buffer(client: AsyncClient) -> None:
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
        json={"courier_tracking_no": "TH999"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "SYNCED_TO_COUCH"


async def test_new_ulid_shape() -> None:
    value = new_ulid()
    assert len(value) == 26
    assert value.isalnum()
    assert value == value.upper()
