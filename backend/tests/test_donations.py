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
from apiapp.modules.donations import use_case as donation_use_case
from apiapp.modules.donations.review import REVIEW_FIELDS
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
    # No counter for c1/rice here (NOT_SEEDED) — the line holds no quota, so it waits for
    # review and so does the booking (CR-174 FR-2, FR-15).
    assert body["status"] == "pending_review"
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
    # CR-174: the projection opens in the status the lines add up to, not at `declared`.
    assert stub.status == "pending_review"
    assert stub.items_declared[0].review_status == "pending"

    track = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)
    assert track.status_code == 200
    tracked = track.json()
    assert tracked["donation"]["booking_ref"] == booking_ref
    assert tracked["donation"]["status"] == "pending_review"
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


async def test_create_donation_passes_logistics_vehicle_plate_through(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    # A valid plate is stored and read back as sent (CR-209 FR-1 checks it on the way in).
    logistics = {
        "delivery_method": "self_dropoff",
        "vehicle": "car",
        "vehicle_plate": "กข 1234 กรุงเทพมหานคร",
    }
    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"free_text": "น้ำดื่ม", "qty": 2, "unit": "pack"}],
            "logistics": logistics,
        },
    )
    assert response.status_code == 201
    token = response.json()["tracking_token"]

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.logistics == logistics

    track = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)
    assert track.status_code == 200
    # FastAPI hands the block to the BFF whole; stripping the plate from the donor-facing
    # tracking response is the BFF allowlist's job.
    assert track.json()["donation"]["logistics"] == logistics


async def _create_with_logistics(
    client: AsyncClient, auth_headers: dict[str, str], logistics: dict[str, object]
):
    return await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"free_text": "น้ำดื่ม", "qty": 2, "unit": "pack"}],
            "logistics": logistics,
        },
    )


async def _buffered_logistics(token: str) -> dict[str, object] | None:
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    return buffer.logistics


async def test_create_donation_trims_the_vehicle_plate_and_drops_a_blank_one(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    # CR-209 FR-1: the same rule as the BFF zod schema, so a caller past the BFF gets it too.
    trimmed = await _create_with_logistics(
        client,
        auth_headers,
        {"delivery_method": "self_dropoff", "vehicle": "car", "vehicle_plate": "  กข 1234  "},
    )
    assert trimmed.status_code == 201
    stored = await _buffered_logistics(trimmed.json()["tracking_token"])
    assert stored is not None and stored["vehicle_plate"] == "กข 1234"

    blank = await _create_with_logistics(
        client,
        auth_headers,
        {"delivery_method": "self_dropoff", "vehicle": "car", "vehicle_plate": "   "},
    )
    assert blank.status_code == 201
    stored = await _buffered_logistics(blank.json()["tracking_token"])
    assert stored is not None and "vehicle_plate" not in stored


async def test_create_donation_allows_40_plate_characters_and_refuses_41(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    ok = await _create_with_logistics(
        client,
        auth_headers,
        {"delivery_method": "self_dropoff", "vehicle": "car", "vehicle_plate": "ก" * 40},
    )
    assert ok.status_code == 201

    too_long = await _create_with_logistics(
        client,
        auth_headers,
        {"delivery_method": "self_dropoff", "vehicle": "car", "vehicle_plate": "ก" * 41},
    )
    assert too_long.status_code == 422


@pytest.mark.parametrize("method", ["parcel", "shelter_pickup"])
async def test_create_donation_refuses_a_vehicle_plate_outside_self_dropoff(
    client: AsyncClient,
    open_shelter: PublicShelter,
    auth_headers: dict[str, str],
    method: str,
) -> None:
    # CR-209 FR-1a: the shelter's own vehicle collects a pickup; a parcel has no vehicle.
    response = await _create_with_logistics(
        client, auth_headers, {"delivery_method": method, "vehicle_plate": "กข 1234"}
    )
    assert response.status_code == 422
    assert await DonationBuffer.find_one(DonationBuffer.shelter_code == "SH001") is None


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
    # CR-172: a booking still in the buffer has never been reviewed — no reason yet.
    assert body["donation"]["reject_reason"] is None
    assert body["donation"]["reject_reason_code"] is None


async def test_tracking_reports_the_reject_reason(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """CR-172 FR-14: the donor sees why the shelter turned the donation down."""
    token = "TX-SH001-REJECT01"
    await PublicDonation(
        id=f"donation:{new_ulid()}",
        tracking_token_hash=sha256_hex(token),
        shelter_code="SH001",
        status="rejected",
        booking_ref="DN-172001",
        items_declared=[{"item_name": "นมกล่อง", "qty": "10", "unit": "กล่อง"}],
        received_summary=None,
        reject_reason="หมดอายุ — กล่องนมหมดอายุ 2 กล่อง",
        reject_reason_code="expired",
        updated_at=datetime.now(UTC),
    ).insert()

    track = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)

    assert track.status_code == 200
    donation = track.json()["donation"]
    assert donation["status"] == "rejected"
    assert donation["reject_reason"] == "หมดอายุ — กล่องนมหมดอายุ 2 กล่อง"
    assert donation["reject_reason_code"] == "expired"


async def test_tracking_passes_rejected_lines_through_received_summary(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """CR-172 FR-3/FR-14: a partly received donation keeps each line's reason."""
    token = "TX-SH001-REJECT02"
    summary = {
        "total_items": 2,
        "received_at": "2026-10-21T03:00:00.000Z",
        "shortfalls": [],
        "items": [
            {"item_id": "item:rice", "qty": "5", "unit": "ถุง"},
            {
                "free_text": "นมกล่อง",
                "qty": "0",
                "unit": "กล่อง",
                "rejected": True,
                "reject_reason": "ชำรุด — กล่องบุบ",
                "reject_reason_code": "damaged",
            },
        ],
    }
    await PublicDonation(
        id=f"donation:{new_ulid()}",
        tracking_token_hash=sha256_hex(token),
        shelter_code="SH001",
        status="received",
        booking_ref="DN-172002",
        items_declared=[],
        received_summary=summary,
        updated_at=datetime.now(UTC),
    ).insert()

    track = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)

    assert track.status_code == 200
    donation = track.json()["donation"]
    assert donation["received_summary"] == summary
    assert donation["reject_reason"] is None
    assert donation["reject_reason_code"] is None


async def test_tracking_a_pre_v6_projection_has_no_reject_reason(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """CR-172 FR-17 / AC-5: a row projected before schema_v 6 lacks both keys entirely."""
    token = "TX-SH001-LEGACY01"
    await PublicDonation.get_pymongo_collection().insert_one(
        {
            "_id": f"donation:{new_ulid()}",
            "tracking_token_hash": sha256_hex(token),
            "shelter_code": "SH001",
            "status": "rejected",
            "booking_ref": "DN-172003",
            "items_declared": [],
            "received_summary": None,
            "updated_at": datetime.now(UTC),
        }
    )

    track = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)

    assert track.status_code == 200
    donation = track.json()["donation"]
    assert donation["status"] == "rejected"
    assert donation["reject_reason"] is None
    assert donation["reject_reason_code"] is None


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
            {
                "item_id": "item:rice",
                "free_text": "ข้าวสาร",
                "qty": 4,
                "unit": "kg",
                "reserved_qty": "4",
            }
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
            {
                "item_id": "item:rice",
                "free_text": "ข้าวสาร",
                "qty": 4,
                "unit": "kg",
                "reserved_qty": "4",
            }
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
        shelter_code="SH001",
        campaign_id="donation_campaign:c5",
        item_id="item:rice",
        qty=Decimal("4"),
        now=datetime.now(UTC),
    )

    counter = await DonationNeedCounter.get(counter_id)
    assert counter is not None
    assert counter.reserved_qty == Decimal("0"), "must clamp at 0, never go negative"


async def test_cancel_missing_donation_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.delete("/public/v1/donations/TX-SH001-NOPE0000", headers=auth_headers)
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
                "items": [{"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 2, "unit": "kg"}],
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
    collection = DonationBuffer.get_pymongo_collection().database["public_config"]
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
    """A booking that holds quota and that the donor may still edit.

    Since CR-196 FR-LK-4 a line holding quota is approved at once, which closes the edit,
    so the only such booking left is one made before schema_v 7: lines with no review and
    no ``line_key``, still ``pending_review``. Booked through the API so the counter really
    holds the quota, then set back to that shape.
    """
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
    token = response.json()["tracking_token"]
    buffer = await _buffer(token)
    legacy = [
        {key: value for key, value in line.items() if key not in (*REVIEW_FIELDS, "line_key")}
        for line in buffer.items_declared
    ]
    await DonationBuffer.get_pymongo_collection().update_one(
        {"_id": buffer.id}, {"$set": {"items_declared": legacy, "status": "pending_review"}}
    )
    return token


async def _reserved(item_id: str = "item:rice") -> Decimal:
    counter = await DonationNeedCounter.find_one(
        DonationNeedCounter.shelter_code == "SH001",
        DonationNeedCounter.item_id == item_id,
    )
    assert counter is not None
    return counter.reserved_qty


async def _edit(client: AsyncClient, headers: dict[str, str], token: str, items: list[dict]):
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
    """CR-080 Q5 — no per-booking limit; the per-IP rate limit at nginx is the only brake.

    Typed lines: they stay in review, so the booking stays editable (CR-196 FR-LK-4).
    """
    token = await _book(client, auth_headers, [{"free_text": "ผ้าห่ม", "qty": "1", "unit": "ผืน"}])

    for qty in ("2", "3", "4"):
        assert (
            await _edit(
                client, auth_headers, token, [{"free_text": "ผ้าห่ม", "qty": qty, "unit": "ผืน"}]
            )
        ).status_code == 200, qty

    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert len(buffer.revisions) == 3
    assert buffer.items_declared[0]["qty"] == "4"


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


@pytest.mark.parametrize("status_value", ["received", "partially_received", "cancelled"])
async def test_a_booking_taken_over_by_staff_may_not_be_edited(
    client: AsyncClient,
    open_shelter: PublicShelter,
    auth_headers: dict[str, str],
    status_value: str,
) -> None:
    """CR-080 Q1 — once the goods arrive, the count is staff's."""
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
    assert (
        response.json()["errors"][0]["error"]
        == f'Cannot edit a donation in status "{status_value}"'
    )
    assert await _reserved() == Decimal("5")


async def test_a_booking_awaiting_review_is_still_the_donors_to_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Typed lines only: nothing decided yet, so the booking is still the donor's (D-1)."""
    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน"}],
        },
    )
    token = response.json()["tracking_token"]
    assert response.json()["status"] == "pending_review"

    edited = await _edit(
        client, auth_headers, token, [{"free_text": "ผ้าห่ม", "qty": "3", "unit": "ผืน"}]
    )

    assert edited.status_code == 200
    assert edited.json()["status"] == "pending_review"


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

    await _edit(client, auth_headers, token, [{"free_text": "สบู่ก้อน", "qty": "10", "unit": "bar"}])

    assert await _reserved("item:soap") == Decimal("10")
    assert await _reserved("item:blanket") == Decimal("0")


# --- capped queue windows: SLOT_FULL decided atomically (public-tier-flow-spec) ---

_SLOT_ID = "SH001:pickup:2026-06-27:10:00"


def _slot_booking(index: int, *, capacity: int = 1, booked: int = 0) -> dict:
    return {
        "shelter_code": "SH001",
        "donor": {"name": f"Donor {index}", "phone": "0812345678"},
        "items": [{"free_text": "ข้าวสาร", "qty": 1, "unit": "kg"}],
        "logistics": {
            "delivery_method": "shelter_pickup",
            "slot": {"date": "2026-06-27", "from": "10:00", "to": "11:00"},
        },
        "slot_hold": {
            "mode": "pickup",
            "date": "2026-06-27",
            "from": "10:00",
            "capacity": capacity,
            "booked": booked,
        },
    }


async def _slot_booked() -> int:
    from tent_model.donation_slot_counter import DonationSlotCounter

    counter = await DonationSlotCounter.get(_SLOT_ID)
    return counter.booked if counter else 0


async def test_two_donors_racing_for_the_last_trip_get_one_place(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The race e2e's pickup case, at the service: both pass the BFF's CouchDB count,
    so only the counter stands between them and a double-booked truck."""

    responses = await asyncio.gather(
        *[
            client.post("/public/v1/donations", headers=auth_headers, json=_slot_booking(i))
            for i in range(2)
        ]
    )

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [201, 409], [r.text for r in responses]
    loser = next(r for r in responses if r.status_code == 409)
    assert loser.json()["errors"][0]["error"] == "SLOT_FULL"
    assert await _slot_booked() == 1
    # The refused booking leaves no staging row holding a place it never got.
    buffers = await DonationBuffer.find(DonationBuffer.slot_counter_id == _SLOT_ID).to_list()
    assert len(buffers) == 1


async def test_many_donors_never_overfill_a_capped_window(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:

    responses = await asyncio.gather(
        *[
            client.post(
                "/public/v1/donations", headers=auth_headers, json=_slot_booking(i, capacity=3)
            )
            for i in range(8)
        ]
    )

    assert sum(r.status_code == 201 for r in responses) == 3
    assert sum(r.status_code == 409 for r in responses) == 5
    assert await _slot_booked() == 3


async def test_places_taken_before_the_counter_existed_still_count(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The first booking seeds the counter from the CouchDB count the BFF sends, so a
    window already full from older bookings refuses rather than starting from 0."""

    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json=_slot_booking(0, capacity=2, booked=2),
    )

    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "SLOT_FULL"
    assert await _slot_booked() == 2


async def test_slot_full_hands_the_quota_back(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Quota is reserved before the place, so a refused place must release it."""
    await _seed_counter("10")
    payload = _slot_booking(0, capacity=1, booked=1)
    payload["campaign_id"] = "donation_campaign:c1"
    payload["items"] = [{"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": 4, "unit": "kg"}]

    response = await client.post("/public/v1/donations", headers=auth_headers, json=payload)

    assert response.status_code == 409
    assert await _reserved() == Decimal("0")


async def test_cancel_gives_the_place_back(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    created = await client.post("/public/v1/donations", headers=auth_headers, json=_slot_booking(0))
    assert created.status_code == 201
    assert await _slot_booked() == 1

    token = created.json()["tracking_token"]
    cancelled = await client.delete(f"/public/v1/donations/{token}", headers=auth_headers)
    assert cancelled.status_code == 200, cancelled.text
    assert await _slot_booked() == 0

    again = await client.post("/public/v1/donations", headers=auth_headers, json=_slot_booking(1))
    assert again.status_code == 201


def _widen_cancel_race(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hold every ``DonationBuffer.save`` open a little before it writes.

    Two cancels in flight together then both observe ``declared`` before either has
    written, which is the interleaving a read→check→save cancel loses to. A cancel that
    flips the status atomically never goes through ``save``, so it is unaffected.
    """
    real_save = DonationBuffer.save

    async def slow_save(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        await asyncio.sleep(0.05)
        return await real_save(self, *args, **kwargs)

    monkeypatch.setattr(DonationBuffer, "save", slow_save)


async def test_concurrent_cancels_release_the_place_once(
    client: AsyncClient,
    open_shelter: PublicShelter,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two cancels of one booking in flight together must hand back one place, not two —
    the second release would free a place that another donor's booking still holds."""
    tokens = []
    for i in range(2):
        created = await client.post(
            "/public/v1/donations", headers=auth_headers, json=_slot_booking(i, capacity=2)
        )
        assert created.status_code == 201, created.text
        tokens.append(created.json()["tracking_token"])
    assert await _slot_booked() == 2
    _widen_cancel_race(monkeypatch)

    responses = await asyncio.gather(
        *[
            client.delete(f"/public/v1/donations/{tokens[0]}", headers=auth_headers)
            for _ in range(2)
        ]
    )

    # The loser gets the same error a sequential second cancel always got.
    assert sorted(r.status_code for r in responses) == [200, 400], [r.text for r in responses]
    assert await _slot_booked() == 1, "the other donor's place must still be held"

    # With one place free and one held, exactly one more booking fits.
    third = await client.post(
        "/public/v1/donations", headers=auth_headers, json=_slot_booking(2, capacity=2)
    )
    assert third.status_code == 201
    fourth = await client.post(
        "/public/v1/donations", headers=auth_headers, json=_slot_booking(3, capacity=2)
    )
    assert fourth.status_code == 409


async def test_concurrent_cancels_release_quota_once(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Quota counterpart of the slot race: another booking's 2 kg must survive."""
    token = "TX-SH001-CANCEL006"
    now = datetime.now(UTC)
    counter_id = "SH001:donation_campaign:c6:item:rice"
    await DonationNeedCounter(
        id=counter_id,
        shelter_code="SH001",
        campaign_id="donation_campaign:c6",
        item_id="item:rice",
        qty_target=Decimal("10"),
        # 4 kg ours + 2 kg someone else's.
        reserved_qty=Decimal("6"),
        created_at=now,
        updated_at=now,
    ).insert()
    await DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code="SH001",
        donor=DonorBuffer(name="Cancel Donor", phone="0844444444"),
        items_declared=[
            {
                "item_id": "item:rice",
                "free_text": "ข้าวสาร",
                "qty": 4,
                "unit": "kg",
                "reserved_qty": "4",
            }
        ],
        campaign_id="donation_campaign:c6",
        booking_ref="DN-777006",
        tracking_token=token,
        tracking_token_hash=sha256_hex(token),
        status="declared",
        synced_to_couch=False,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()
    _widen_cancel_race(monkeypatch)

    responses = await asyncio.gather(
        *[client.delete(f"/public/v1/donations/{token}", headers=auth_headers) for _ in range(2)]
    )

    assert sorted(r.status_code for r in responses) == [200, 400], [r.text for r in responses]
    counter = await DonationNeedCounter.get(counter_id)
    assert counter is not None
    assert counter.reserved_qty == Decimal("2")


async def test_a_booking_without_a_hold_takes_no_place(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Uncapped windows send no hold — they never get a counter."""
    payload = _slot_booking(0)
    del payload["slot_hold"]

    response = await client.post("/public/v1/donations", headers=auth_headers, json=payload)

    assert response.status_code == 201
    buffer = await DonationBuffer.find_one(
        DonationBuffer.booking_ref == response.json()["booking_ref"]
    )
    assert buffer is not None and buffer.slot_counter_id is None


# --- per-line review (CR-174) ---

_RICE = {"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": "5", "unit": "kg"}
_BLANKET = {"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน"}


async def _buffer(token: str) -> DonationBuffer:
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    return buffer


async def _stub(token: str) -> PublicDonation:
    stub = await PublicDonation.find_one(PublicDonation.tracking_token_hash == sha256_hex(token))
    assert stub is not None
    return stub


async def _create(client: AsyncClient, headers: dict[str, str], items: list[dict]) -> dict:
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
    return response.json()


async def test_ac1_a_campaign_only_booking_opens_verifying(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    body = await _create(client, auth_headers, [_RICE])

    assert body["status"] == "verifying"
    buffer = await _buffer(body["tracking_token"])
    assert buffer.status == "verifying"
    assert buffer.items_declared[0]["review_status"] == "approved"
    stub = await _stub(body["tracking_token"])
    assert stub.status == "verifying"
    assert stub.items_declared[0].review_status == "approved"

    tracked = await client.get(
        f"/public/v1/donations/{body['tracking_token']}", headers=auth_headers
    )
    assert tracked.json()["donation"]["items"][0]["review_status"] == "approved"


async def test_ac2_a_mixed_booking_waits_for_the_typed_line(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    body = await _create(client, auth_headers, [_RICE, _BLANKET])

    assert body["status"] == "pending_review"
    buffer = await _buffer(body["tracking_token"])
    assert [i["review_status"] for i in buffer.items_declared] == ["approved", "pending"]


async def test_ac4_a_typed_only_booking_opens_pending_review(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    body = await _create(client, auth_headers, [_BLANKET])

    assert body["status"] == "pending_review"
    buffer = await _buffer(body["tracking_token"])
    assert buffer.items_declared[0]["review_status"] == "pending"


async def test_a_campaign_line_without_a_counter_waits(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """FR-2 — NOT_SEEDED goes through unreserved, so it is not approved."""
    body = await _create(client, auth_headers, [_RICE])

    assert body["status"] == "pending_review"


async def _create_typed(client: AsyncClient, headers: dict[str, str], items: list[dict]) -> str:
    """A booking nothing was decided on: typed lines, or campaign lines with no counter."""
    body = await _create(client, headers, items)
    assert body["status"] == "pending_review"
    return body["tracking_token"]


async def test_an_edited_campaign_line_is_approved_and_reported(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """FR-2 / FR-26 — booked before the counter was seeded, so it waited; now it holds quota."""
    token = await _create_typed(client, auth_headers, [_BLANKET, _RICE])
    held = (await _buffer(token)).items_declared
    await _seed_counter("100")

    body = (
        await _edit(
            client,
            auth_headers,
            token,
            [
                {**_BLANKET, "line_key": held[0]["line_key"]},
                {**_RICE, "qty": "8", "line_key": held[1]["line_key"]},
            ],
        )
    ).json()

    assert [i["review_status"] for i in body["items"]] == ["pending", "approved"]
    assert body["auto_approved_lines"] == [1]
    assert body["status"] == "pending_review"


async def test_the_couch_status_gates_the_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    token = await _create_typed(client, auth_headers, [_BLANKET])

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={"items": [{**_BLANKET, "qty": "9"}], "current_status": "received"},
    )

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == 'Cannot edit a donation in status "received"'
    assert (await _buffer(token)).items_declared[0]["qty"] == "2"


async def test_a_receipt_settled_during_the_edit_is_not_written_back(
    client: AsyncClient,
    open_shelter: PublicShelter,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Staff received the goods after the BFF read CouchDB but before the edit saved.

    The quota settle released must stay released, and the buffer must keep ``received``,
    or retention hands the quota back a second time when the row ages out.
    """
    await _seed_counter("100")
    token = await _book(client, auth_headers, [_RICE])

    async def settle_lands_first(**kwargs: object) -> object:
        await DonationBuffer.get_pymongo_collection().update_one(
            {"tracking_token_hash": sha256_hex(token)}, {"$set": {"status": "received"}}
        )
        return await reserve_quota(**kwargs)

    monkeypatch.setattr(donation_use_case, "reserve_quota", settle_lands_first)

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [{**_RICE, "qty": "9"}],
            "current_items": [{**_RICE, "reserved_qty": "5"}],
            "current_status": "pending_review",
        },
    )

    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "BOOKING_CHANGED"
    assert (await _buffer(token)).status == "received"
    assert await _reserved() == Decimal("5")


async def test_a_buffer_settle_already_moved_on_is_not_edited(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The BFF's CouchDB read is older than the settle that already reached the buffer."""
    await _seed_counter("100")
    token = await _book(client, auth_headers, [_RICE])
    await DonationBuffer.get_pymongo_collection().update_one(
        {"tracking_token_hash": sha256_hex(token)}, {"$set": {"status": "received"}}
    )

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [{**_RICE, "qty": "9"}],
            "current_items": [{**_RICE, "reserved_qty": "5"}],
            "current_status": "pending_review",
        },
    )

    assert response.status_code == 400
    assert (await _buffer(token)).status == "received"
    assert await _reserved() == Decimal("5")


async def _legacy_booking(token: str, status_value: str, items: list[dict]) -> None:
    """A booking from before schema_v 7 — synced, no review fields or line keys anywhere."""
    now = datetime.now(UTC)
    donation_id = f"donation:{new_ulid()}"
    await DonationBuffer(
        id=donation_id,
        shelter_code="SH001",
        donor=DonorBuffer(name="Legacy", phone="0812345678"),
        items_declared=items,
        campaign_id="donation_campaign:c1",
        booking_ref=f"DN-{abs(hash(token)) % 900000 + 100000}",
        tracking_token=token,
        tracking_token_hash=sha256_hex(token),
        status="pending_review",
        synced_to_couch=True,
        created_at=now,
        expires_at=now + timedelta(hours=72),
    ).insert()
    await PublicDonation(
        id=donation_id,
        tracking_token_hash=sha256_hex(token),
        shelter_code="SH001",
        status=status_value,
        booking_ref="DN-1",
        items_declared=[],
        updated_at=now,
    ).insert()


async def test_ac20_legacy_pending_review_is_judged_like_a_new_booking(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = "TX-SH001-LEGACYP"
    await _legacy_booking(token, "pending_review", [_RICE, _BLANKET])

    body = (await _edit(client, auth_headers, token, [_RICE, {**_BLANKET, "qty": "3"}])).json()

    assert body["status"] == "pending_review"
    assert [i["review_status"] for i in body["items"]] == ["approved", "pending"]
    assert body["auto_approved_lines"] == [0]


async def test_ac21_a_declared_booking_stays_declared(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = "TX-SH001-LEGACYD"
    await _legacy_booking(token, "declared", [_RICE])

    body = (await _edit(client, auth_headers, token, [{**_RICE, "qty": "4"}])).json()

    assert body["status"] == "declared"
    assert all("review_status" not in item for item in body["items"])
    assert body["auto_approved_lines"] == []


async def test_ac9_a_verifying_booking_can_be_cancelled(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """CR-196 FR-LK-10 — the edit is closed, the cancel is not."""
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE]))["tracking_token"]
    assert await _reserved() == Decimal("5")

    response = await client.delete(f"/public/v1/donations/{token}", headers=auth_headers)

    assert response.status_code == 200
    assert await _reserved() == Decimal("0")


async def test_ac11_a_verifying_booking_takes_a_courier_number(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """CR-196 FR-LK-11 — the edit is closed, the courier number is not."""
    await _seed_counter("100")
    response = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "campaign_id": "donation_campaign:c1",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [_RICE],
            "logistics": {"delivery_method": "parcel"},
        },
    )
    assert response.json()["status"] == "verifying"
    token = response.json()["tracking_token"]

    patched = await client.patch(
        f"/public/v1/donations/{token}",
        headers=auth_headers,
        json={"courier_tracking_no": "TH123"},
    )

    assert patched.status_code == 200
    assert ((await _buffer(token)).logistics or {})["courier_tracking_no"] == "TH123"


async def test_an_unseeded_line_stays_in_review_across_edits(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """No counter = no reservation, so no "held" quantity for the next edit to lean on."""
    token = (await _create(client, auth_headers, [_RICE]))["tracking_token"]

    first = (await _edit(client, auth_headers, token, [{**_RICE, "qty": "6"}])).json()
    second = (
        await _edit(client, auth_headers, token, [{**_RICE, "qty": "6", "note": "แพ็คละ 1 kg"}])
    ).json()

    assert first["items"][0]["review_status"] == "pending"
    assert "reserved_qty" not in first["items"][0]
    assert second["items"][0]["review_status"] == "pending"
    assert second["status"] == "pending_review"
    assert second["auto_approved_lines"] == []


async def test_a_synced_edit_leaves_the_projection_status_to_the_projector(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = await _create_typed(client, auth_headers, [_BLANKET])
    couch_items = (await _buffer(token)).items_declared

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={"items": [_RICE], "current_items": couch_items, "current_status": "pending_review"},
    )

    assert response.json()["status"] == "verifying"
    assert (await _buffer(token)).status == "verifying"
    # The BFF writes CouchDB next; the projector carries that to public_donations.
    assert (await _stub(token)).status == "pending_review"


# --- CR-196: lines carry a line_key; an edit is closed once anything was decided ---

#: Lines as the donate wizard writes them: category/condition/note included.
_WIZARD_RICE = {**_RICE, "category": "อาหารแห้ง", "note": "ถุงละ 5 kg"}
_NEW_SHIRT = {"free_text": "เสื้อ", "qty": "3", "unit": "ตัว", "condition": "ของใหม่"}
_USED_SHIRT = {**_NEW_SHIRT, "condition": "มือสอง"}


def _as_edit_form(line: dict) -> dict:
    """What ``edit-donation-items-dialog.svelte`` sends for a held line (DonationItemEdit)."""
    return {
        key: line[key] for key in ("line_key", "item_id", "free_text", "qty", "unit") if key in line
    }


def _is_ulid(value: object) -> bool:
    return isinstance(value, str) and len(value) == 26 and set(value) <= set(_CROCKFORD)


_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


async def test_lk_ac1_every_line_is_booked_with_its_own_key(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """FR-LK-1..3 — a ULID per line, whatever the client sent, and GET hands it back."""
    token = (
        await _create(client, auth_headers, [{**_NEW_SHIRT, "line_key": "CLIENT-CHOSEN"}, _BLANKET])
    )["tracking_token"]

    keys = [line["line_key"] for line in (await _buffer(token)).items_declared]
    assert all(_is_ulid(key) for key in keys)
    assert len(set(keys)) == 2
    tracked = await client.get(f"/public/v1/donations/{token}", headers=auth_headers)
    assert [i["line_key"] for i in tracked.json()["donation"]["items"]] == keys


async def test_lk_ac2_a_booking_with_its_qr_cannot_be_edited(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE]))["tracking_token"]
    held = (await _buffer(token)).items_declared

    response = await _edit(client, auth_headers, token, [{**_as_edit_form(held[0]), "qty": "9"}])

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == "ALREADY_REVIEWED"
    assert await _reserved() == Decimal("5")
    assert (await _buffer(token)).revisions == []


async def test_lk_ac2_a_line_approved_by_the_campaign_rule_closes_the_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Still ``pending_review`` for the typed line, but the rice was already approved."""
    await _seed_counter("100")
    body = await _create(client, auth_headers, [_RICE, _BLANKET])
    assert body["status"] == "pending_review"

    response = await _edit(client, auth_headers, body["tracking_token"], [_BLANKET])

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == "ALREADY_REVIEWED"
    assert await _reserved() == Decimal("5")


async def test_lk_ac2_a_staff_refusal_read_from_couch_closes_the_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Review #783 H1 — A "new shirt" approved, B "used shirt" refused; the donor drops A.

    The edit used to pair what was left with A and approve B. Now nothing is paired: the
    booking was reviewed, so the edit is refused and B stays refused.
    """
    token = await _create_typed(client, auth_headers, [_NEW_SHIRT, _USED_SHIRT])
    held = (await _buffer(token)).items_declared
    couch_items = [
        {**held[0], "review_status": "approved"},
        {
            **held[1],
            "review_status": "rejected",
            "review_reason_code": "damaged",
            "review_reason": "ชำรุดเสียหาย",
        },
    ]

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [_as_edit_form(held[1])],
            "current_items": couch_items,
            "current_status": "verifying",
        },
    )

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == "ALREADY_REVIEWED"
    assert [line["line_key"] for line in (await _buffer(token)).items_declared] == [
        held[0]["line_key"],
        held[1]["line_key"],
    ]


async def test_lk_ac2_a_rejected_line_closes_the_edit_even_while_in_review(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """A refusal next to a pending line — left by an edit made before CR-196."""
    token = await _create_typed(client, auth_headers, [_NEW_SHIRT, _USED_SHIRT])
    held = (await _buffer(token)).items_declared

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [_as_edit_form(held[0])],
            "current_items": [held[0], {**held[1], "review_status": "rejected"}],
            "current_status": "pending_review",
        },
    )

    assert response.json()["errors"][0]["error"] == "ALREADY_REVIEWED"


async def test_lk_ac2_a_legacy_booking_staff_approved_cannot_be_edited(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """FR-18c no longer applies to ``verifying``: staff approved the whole booking."""
    token = "TX-SH001-LEGACYV"
    await _legacy_booking(token, "verifying", [_BLANKET])

    response = await _edit(client, auth_headers, token, [{**_BLANKET, "qty": "7"}])

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == "ALREADY_REVIEWED"


async def test_lk_ac3_an_untouched_line_keeps_its_key_and_its_details(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The form sends back only key/item_id/name/qty/unit; the rest comes off the held line."""
    token = await _create_typed(client, auth_headers, [_WIZARD_RICE, _NEW_SHIRT])
    held = (await _buffer(token)).items_declared
    await _seed_counter("100")

    body = (
        await _edit(
            client,
            auth_headers,
            token,
            [{**_as_edit_form(held[0]), "qty": "8"}, _as_edit_form(held[1])],
        )
    ).json()

    assert [i["line_key"] for i in body["items"]] == [held[0]["line_key"], held[1]["line_key"]]
    assert body["items"][0]["category"] == "อาหารแห้ง"
    assert body["items"][0]["note"] == "ถุงละ 5 kg"
    assert body["items"][1]["condition"] == "ของใหม่"
    # Only the rice item moves on the counter; the typed shirt holds nothing.
    assert await _reserved() == Decimal("8")
    assert "reserved_qty" not in body["items"][1]


async def test_lk_a_detail_the_request_does_send_wins(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    token = await _create_typed(client, auth_headers, [_NEW_SHIRT])
    held = (await _buffer(token)).items_declared

    body = (
        await _edit(client, auth_headers, token, [{**_as_edit_form(held[0]), "condition": "มือสอง"}])
    ).json()

    assert body["items"][0]["condition"] == "มือสอง"
    assert body["items"][0]["line_key"] == held[0]["line_key"]


async def test_lk_deleting_one_of_two_same_name_lines_keeps_the_other_as_it_was(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Two "เสื้อ" lines: the key says which one stayed — no guessing by name."""
    token = await _create_typed(client, auth_headers, [_NEW_SHIRT, _USED_SHIRT])
    held = (await _buffer(token)).items_declared

    body = (await _edit(client, auth_headers, token, [_as_edit_form(held[1])])).json()

    assert len(body["items"]) == 1
    assert body["items"][0]["line_key"] == held[1]["line_key"]
    assert body["items"][0]["condition"] == "มือสอง"


async def test_lk_reordered_lines_keep_their_own_keys_and_details(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    token = await _create_typed(client, auth_headers, [_NEW_SHIRT, _USED_SHIRT])
    held = (await _buffer(token)).items_declared

    body = (
        await _edit(client, auth_headers, token, [_as_edit_form(held[1]), _as_edit_form(held[0])])
    ).json()

    assert [i["line_key"] for i in body["items"]] == [held[1]["line_key"], held[0]["line_key"]]
    assert [i["condition"] for i in body["items"]] == ["มือสอง", "ของใหม่"]


async def test_lk_ac6_an_added_line_gets_a_new_key(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    token = await _create_typed(client, auth_headers, [_NEW_SHIRT])
    held = (await _buffer(token)).items_declared

    body = (await _edit(client, auth_headers, token, [_as_edit_form(held[0]), _BLANKET])).json()

    added = body["items"][1]["line_key"]
    assert _is_ulid(added)
    assert added != held[0]["line_key"]
    assert [line.line_key for line in (await _stub(token)).items_declared] == [
        held[0]["line_key"],
        added,
    ]


async def test_lk_ac4_a_key_the_booking_does_not_hold_is_refused(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    token = await _create_typed(client, auth_headers, [_RICE])
    await _seed_counter("100")

    response = await _edit(
        client, auth_headers, token, [{**_RICE, "qty": "9", "line_key": new_ulid()}]
    )

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == "UNKNOWN_LINE_KEY"
    assert await _reserved() == Decimal("0")
    assert (await _buffer(token)).revisions == []


async def test_lk_ac5_a_key_named_twice_is_refused(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    token = await _create_typed(client, auth_headers, [_RICE, _BLANKET])
    held = (await _buffer(token)).items_declared
    await _seed_counter("100")

    response = await _edit(
        client,
        auth_headers,
        token,
        [_as_edit_form(held[0]), {**_as_edit_form(held[1]), "line_key": held[0]["line_key"]}],
    )

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == "DUPLICATE_LINE_KEY"
    assert await _reserved() == Decimal("0")
    assert (await _buffer(token)).items_declared == held


async def test_lk_fr7_a_booking_from_before_line_keys_gets_them_on_its_first_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-LEGACYK"
    await _legacy_booking(token, "pending_review", [_NEW_SHIRT, _BLANKET])

    body = (await _edit(client, auth_headers, token, [_NEW_SHIRT, _BLANKET])).json()

    keys = [i["line_key"] for i in body["items"]]
    assert all(_is_ulid(key) for key in keys)
    assert len(set(keys)) == 2


async def test_lk_fr7_a_booking_from_before_line_keys_holds_no_key_to_name(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    token = "TX-SH001-LEGACYU"
    await _legacy_booking(token, "pending_review", [_BLANKET])

    response = await _edit(client, auth_headers, token, [{**_BLANKET, "line_key": new_ulid()}])

    assert response.json()["errors"][0]["error"] == "UNKNOWN_LINE_KEY"


async def test_lk_sending_the_same_edit_twice_settles_on_the_same_booking(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """A retried request (the first answer lost) ends where the first one did."""
    token = await _create_typed(client, auth_headers, [_NEW_SHIRT, _USED_SHIRT])
    held = (await _buffer(token)).items_declared
    edit = [{**_as_edit_form(held[1]), "qty": "5"}, _BLANKET]

    first = (await _edit(client, auth_headers, token, edit)).json()
    second = await _edit(client, auth_headers, token, edit)

    assert second.status_code == 200
    assert second.json()["items"][0]["line_key"] == held[1]["line_key"]
    # The added line has no key to send, so each attempt mints one; the rest is the same.
    assert [{**i, "line_key": None} for i in second.json()["items"]] == [
        {**i, "line_key": None} for i in first["items"]
    ]


async def test_lk_a_retry_after_the_edit_was_approved_moves_no_more_quota(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The first attempt landed and approved the water, so the retry meets a reviewed
    booking — refused, with the quota the first attempt took left as it is."""
    token = await _create_typed(client, auth_headers, [_BLANKET])
    held = (await _buffer(token)).items_declared
    await _seed_counter("100", "item:water")
    edit = [
        _as_edit_form(held[0]),
        {"item_id": "item:water", "free_text": "น้ำดื่ม", "qty": "12", "unit": "ขวด"},
    ]

    assert (await _edit(client, auth_headers, token, edit)).status_code == 200
    retry = await _edit(client, auth_headers, token, edit)

    assert retry.json()["errors"][0]["error"] == "ALREADY_REVIEWED"
    assert await _reserved("item:water") == Decimal("12")


_PHOTO_IDS = ["image:01K8PHXTX00000000000000001", "image:01K8PHXTX00000000000000002"]


async def _create_unsolicited(client: AsyncClient, auth_headers: dict[str, str], **extra):
    return await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": [{"free_text": "ผ้าห่ม", "qty": 2, "unit": "ผืน"}],
            **extra,
        },
    )


async def test_create_donation_keeps_photos_and_waits_to_bind_them(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    # CR-175 FR-11: the ids ride the buffer to CouchDB; the worker binds them (FR-11a).
    response = await _create_unsolicited(client, auth_headers, photos=_PHOTO_IDS)
    assert response.status_code == 201

    buffer = await DonationBuffer.find_one(
        DonationBuffer.booking_ref == response.json()["booking_ref"]
    )
    assert buffer is not None
    assert buffer.photos == _PHOTO_IDS
    assert buffer.photos_linked is False

    # FR-14 — the donor's tracking page has no photo read path.
    tracking = await client.get(
        f"/public/v1/donations/{response.json()['tracking_token']}", headers=auth_headers
    )
    assert tracking.status_code == 200
    assert "photos" not in tracking.json()["donation"]


async def test_create_donation_without_photos_has_nothing_to_bind(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    response = await _create_unsolicited(client, auth_headers)
    assert response.status_code == 201

    buffer = await DonationBuffer.find_one(
        DonationBuffer.booking_ref == response.json()["booking_ref"]
    )
    assert buffer is not None
    assert buffer.photos == []
    assert buffer.photos_linked is True


async def test_create_donation_refuses_more_than_30_photos(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    photos = [f"image:01K8PHXTX{n:017d}" for n in range(31)]
    response = await _create_unsolicited(client, auth_headers, photos=photos)
    assert response.status_code == 422
    assert await DonationBuffer.find_all().count() == 0
