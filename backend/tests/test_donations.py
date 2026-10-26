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
    """CR-080 Q5 — no per-booking limit; the per-IP rate limit at nginx is the only brake."""
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


@pytest.mark.parametrize("status_value", ["received", "partially_received", "cancelled"])
async def test_a_booking_taken_over_by_staff_may_not_be_edited(
    client: AsyncClient,
    open_shelter: PublicShelter,
    auth_headers: dict[str, str],
    status_value: str,
) -> None:
    """CR-080 Q1 — once the goods arrive, the count is staff's.

    ``pending_review`` and ``verifying`` are deliberately absent: the goods are still with
    the donor in both (CR-174 FR-20..FR-23). They have their own tests below.
    """
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


async def test_a_booking_awaiting_review_is_still_the_donors_to_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """A booking with a typed line opens at ``pending_review`` (CR-174 FR-7).

    Gating edits on ``declared`` alone would take edit and cancel away from every such
    booking, which is the opposite of what CR-080 Q1 protects. Mirrors
    ``isDonorEditable`` on the BFF.
    """
    await _seed_counter("100")
    token = await _book(
        client,
        auth_headers,
        [
            {"item_id": "item:rice", "qty": "5", "unit": "kg"},
            {"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน"},
        ],
    )
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.status == "pending_review", "a typed line should keep it in review"

    response = await _edit(
        client,
        auth_headers,
        token,
        [
            {"item_id": "item:rice", "qty": "9", "unit": "kg"},
            {"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน"},
        ],
    )

    assert response.status_code == 200
    assert await _reserved() == Decimal("9")


async def test_a_verifying_booking_is_still_the_donors_to_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """CR-174 FR-21 — the QR is out but the goods are not; the donor may still edit."""
    await _seed_counter("100")
    token = await _book(client, auth_headers, [{"item_id": "item:rice", "qty": "5", "unit": "kg"}])
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    assert buffer.status == "verifying"

    response = await _edit(
        client, auth_headers, token, [{"item_id": "item:rice", "qty": "9", "unit": "kg"}]
    )

    assert response.status_code == 200
    assert response.json()["status"] == "verifying"
    assert await _reserved() == Decimal("9")


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


async def test_ac7_adding_a_typed_line_sends_a_verifying_booking_back(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE]))["tracking_token"]

    response = await _edit(client, auth_headers, token, [_RICE, _BLANKET])

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending_review"
    assert [i["review_status"] for i in body["items"]] == ["approved", "pending"]
    assert body["auto_approved_lines"] == []
    assert (await _buffer(token)).status == "pending_review"
    stub = await _stub(token)
    assert stub.status == "pending_review"
    assert [i.review_status for i in stub.items_declared] == ["approved", "pending"]


async def test_ac22_dropping_the_typed_line_moves_to_verifying(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE, _BLANKET]))["tracking_token"]

    body = (await _edit(client, auth_headers, token, [_RICE])).json()

    assert body["status"] == "verifying"
    # Approved at creation (inbound audits it) — not a new automatic approval.
    assert body["auto_approved_lines"] == []


async def test_an_edited_campaign_line_is_approved_again_and_reported(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE, _BLANKET]))["tracking_token"]

    body = (await _edit(client, auth_headers, token, [_BLANKET, {**_RICE, "qty": "8"}])).json()

    assert [i["review_status"] for i in body["items"]] == ["pending", "approved"]
    assert body["auto_approved_lines"] == [1]


async def test_ac10_the_couch_review_is_what_an_edit_starts_from(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Staff approved the typed line in CouchDB; the BFF sends that state along."""
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE, _BLANKET]))["tracking_token"]
    couch_items = [
        {**_RICE, "reserved_qty": "5", "review_status": "approved"},
        {**_BLANKET, "review_status": "approved"},
    ]

    untouched = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [{**_RICE, "qty": "6"}, _BLANKET],
            "current_items": couch_items,
            "current_status": "verifying",
        },
    )
    assert untouched.status_code == 200
    assert untouched.json()["status"] == "verifying"
    assert [i["review_status"] for i in untouched.json()["items"]] == ["approved", "approved"]

    edited = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [{**_RICE, "qty": "6"}, {**_BLANKET, "note": "ยังไม่แกะ"}],
            "current_items": untouched.json()["items"],
            "current_status": "verifying",
        },
    )
    assert edited.json()["status"] == "pending_review"
    assert [i["review_status"] for i in edited.json()["items"]] == ["approved", "pending"]


async def test_the_couch_status_gates_the_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE]))["tracking_token"]

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={"items": [{**_RICE, "qty": "9"}], "current_status": "received"},
    )

    assert response.status_code == 400
    assert await _reserved() == Decimal("5")


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
    token = (await _create(client, auth_headers, [_RICE]))["tracking_token"]

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
            "current_items": [{**_RICE, "reserved_qty": "5", "review_status": "approved"}],
            "current_status": "verifying",
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
    token = (await _create(client, auth_headers, [_RICE]))["tracking_token"]
    await DonationBuffer.get_pymongo_collection().update_one(
        {"tracking_token_hash": sha256_hex(token)}, {"$set": {"status": "received"}}
    )

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [{**_RICE, "qty": "9"}],
            "current_items": [{**_RICE, "reserved_qty": "5", "review_status": "approved"}],
            "current_status": "verifying",
        },
    )

    assert response.status_code == 400
    assert (await _buffer(token)).status == "received"
    assert await _reserved() == Decimal("5")


async def _legacy_booking(token: str, status_value: str, items: list[dict]) -> None:
    """A booking from before schema_v 7 — synced, no review fields anywhere."""
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


async def test_ac19_legacy_verifying_keeps_the_typed_line_approved(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _seed_counter("100")
    await reserve_quota(
        shelter_code="SH001",
        campaign_id="donation_campaign:c1",
        item_id="item:rice",
        qty=Decimal("5"),
        now=datetime.now(UTC),
    )
    token = "TX-SH001-LEGACYV"
    held = [{**_RICE, "reserved_qty": "5"}, _BLANKET]
    await _legacy_booking(token, "verifying", held)

    # No current_* sent: the projection's status is what staff left it at.
    body = (await _edit(client, auth_headers, token, [{**_RICE, "qty": "7"}, _BLANKET])).json()

    assert body["status"] == "verifying"
    assert [i["review_status"] for i in body["items"]] == ["approved", "approved"]
    assert body["auto_approved_lines"] == [0]


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
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE]))["tracking_token"]
    assert await _reserved() == Decimal("5")

    response = await client.delete(f"/public/v1/donations/{token}", headers=auth_headers)

    assert response.status_code == 200
    assert await _reserved() == Decimal("0")


async def test_ac11_a_verifying_booking_takes_a_courier_number(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
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


# --- review follow-ups (PR review 2026-10-22) ---


async def test_an_edit_keeping_only_refused_lines_is_refused_before_quota_moves(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Dropping every accepted line would read as "the shelter refused" — cancel instead."""
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_RICE, _BLANKET]))["tracking_token"]
    couch_items = [
        {**_RICE, "reserved_qty": "5", "review_status": "approved"},
        {
            **_BLANKET,
            "review_status": "rejected",
            "review_reason_code": "damaged",
            "review_reason": "ชำรุดเสียหาย",
        },
    ]

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={"items": [_BLANKET], "current_items": couch_items, "current_status": "verifying"},
    )

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == "NO_ACCEPTED_ITEMS"
    assert await _reserved() == Decimal("5")
    assert [i.get("free_text") for i in (await _buffer(token)).items_declared] == [
        "ข้าวสาร",
        "ผ้าห่ม",
    ]


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
    created = await _create(client, auth_headers, [_RICE])
    token = created["tracking_token"]
    assert (await _stub(token)).status == "verifying"

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [_RICE, _BLANKET],
            "current_items": [{**_RICE, "reserved_qty": "5", "review_status": "approved"}],
            "current_status": "verifying",
        },
    )

    assert response.json()["status"] == "pending_review"
    assert (await _buffer(token)).status == "pending_review"
    # The BFF writes CouchDB next; the projector carries that to public_donations.
    assert (await _stub(token)).status == "verifying"


# --- the edit form sends back only item_id/free_text/qty/unit (full-branch review B1) ---

#: Lines as the donate wizard writes them: category/condition/note included.
_WIZARD_RICE = {**_RICE, "category": "อาหารแห้ง", "note": "ถุงละ 5 kg"}
_WIZARD_BLANKET = {**_BLANKET, "category": "เครื่องนอน", "condition": "ของใหม่ 100%"}
_WIZARD_PILLOW = {"free_text": "หมอน", "qty": "1", "unit": "ใบ", "category": "เครื่องนอน"}


def _as_edit_form(line: dict) -> dict:
    """What ``edit-donation-items-dialog.svelte`` sends for a line (DonationItemEdit)."""
    return {key: line[key] for key in ("item_id", "free_text", "qty", "unit") if key in line}


async def test_an_edit_from_the_form_keeps_staff_decisions_on_untouched_lines(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Changing one quantity must not re-open the lines staff already decided (FR-18a)."""
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_WIZARD_RICE, _WIZARD_BLANKET, _WIZARD_PILLOW]))[
        "tracking_token"
    ]
    couch_items = [
        {**_WIZARD_RICE, "reserved_qty": "5", "review_status": "approved"},
        {
            **_WIZARD_BLANKET,
            "review_status": "rejected",
            "review_reason_code": "damaged",
            "review_reason": "ชำรุดเสียหาย",
        },
        {**_WIZARD_PILLOW, "review_status": "approved"},
    ]

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [
                _as_edit_form({**_WIZARD_RICE, "qty": "6"}),
                _as_edit_form(_WIZARD_BLANKET),
                _as_edit_form(_WIZARD_PILLOW),
            ],
            "current_items": couch_items,
            "current_status": "verifying",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "verifying"
    assert [i["review_status"] for i in body["items"]] == ["approved", "rejected", "approved"]
    assert body["items"][1]["review_reason"] == "ชำรุดเสียหาย"
    # Only the line the donor really changed was approved again.
    assert body["auto_approved_lines"] == [0]
    # And what the wizard recorded survives the edit.
    assert body["items"][0]["category"] == "อาหารแห้ง"
    assert body["items"][0]["note"] == "ถุงละ 5 kg"
    assert body["items"][1]["condition"] == "ของใหม่ 100%"
    assert body["items"][2]["category"] == "เครื่องนอน"


async def test_a_detail_the_request_does_change_is_still_an_edit(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Carrying fills only what is missing — a client that sends a new condition wins."""
    await _seed_counter("100")
    token = (await _create(client, auth_headers, [_WIZARD_RICE, _WIZARD_BLANKET]))["tracking_token"]
    couch_items = [
        {**_WIZARD_RICE, "reserved_qty": "5", "review_status": "approved"},
        {**_WIZARD_BLANKET, "review_status": "approved"},
    ]

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [
                _as_edit_form(_WIZARD_RICE),
                {**_as_edit_form(_WIZARD_BLANKET), "condition": "มือสอง"},
            ],
            "current_items": couch_items,
            "current_status": "verifying",
        },
    )

    body = response.json()
    assert [i["review_status"] for i in body["items"]] == ["approved", "pending"]
    assert body["items"][1]["condition"] == "มือสอง"
    assert body["status"] == "pending_review"


async def test_lines_of_one_name_with_different_details_are_not_guessed(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Re-review round 3 W1 — deleting the first of two "เสื้อ" lines must not hand the
    refused one the deleted one's details, and with them its approval."""
    await _seed_counter("100")
    new_shirt = {"free_text": "เสื้อ", "qty": "3", "unit": "ตัว", "condition": "ของใหม่"}
    used_shirt = {"free_text": "เสื้อ", "qty": "3", "unit": "ตัว", "condition": "มือสอง"}
    token = (await _create(client, auth_headers, [new_shirt, used_shirt, _WIZARD_PILLOW]))[
        "tracking_token"
    ]
    couch_items = [
        {**new_shirt, "review_status": "approved"},
        {
            **used_shirt,
            "review_status": "rejected",
            "review_reason_code": "damaged",
            "review_reason": "ชำรุดเสียหาย",
        },
        {**_WIZARD_PILLOW, "review_status": "approved"},
    ]

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [_as_edit_form(used_shirt), _as_edit_form(_WIZARD_PILLOW)],
            "current_items": couch_items,
            "current_status": "verifying",
        },
    )

    body = response.json()
    assert [i["review_status"] for i in body["items"]] == ["pending", "approved"]
    assert body["items"][0].get("condition") is None
    assert body["status"] == "pending_review"


async def test_a_refused_campaign_line_of_a_shared_name_is_not_auto_approved(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Review #783 H1 — same as above with campaign lines: the one left holds quota, so
    FR-2 alone approved the refused shirt and gave the booking its QR back."""
    await _seed_counter("100", "item:shirt")
    new_shirt = {
        "item_id": "item:shirt",
        "free_text": "เสื้อ",
        "qty": "3",
        "unit": "ตัว",
        "condition": "ของใหม่",
    }
    used_shirt = {**new_shirt, "condition": "มือสอง"}
    token = (await _create(client, auth_headers, [new_shirt, used_shirt]))["tracking_token"]
    couch_items = [
        {**new_shirt, "reserved_qty": "6", "review_status": "approved"},
        {
            **used_shirt,
            "reserved_qty": "6",
            "review_status": "rejected",
            "review_reason_code": "damaged",
            "review_reason": "ชำรุดเสียหาย",
        },
    ]

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [_as_edit_form(used_shirt)],
            "current_items": couch_items,
            "current_status": "verifying",
        },
    )

    body = response.json()
    assert response.status_code == 200, body
    assert [i["review_status"] for i in body["items"]] == ["pending"]
    assert body["auto_approved_lines"] == []
    assert body["status"] == "pending_review"


async def test_lines_of_one_name_with_the_same_details_keep_them(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    shirt = {"free_text": "เสื้อ", "qty": "3", "unit": "ตัว", "condition": "ของใหม่"}
    token = (await _create(client, auth_headers, [shirt, {**shirt, "qty": "2"}]))["tracking_token"]

    response = await _edit(
        client, auth_headers, token, [_as_edit_form(shirt), _as_edit_form({**shirt, "qty": "2"})]
    )

    assert [i.get("condition") for i in response.json()["items"]] == ["ของใหม่", "ของใหม่"]


async def test_a_name_saved_with_a_trailing_space_keeps_its_review(
    client: AsyncClient, open_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Re-review round 3 W2 — the wizard keeps the space, the edit form trims it."""
    await _seed_counter("100")
    spaced = {**_WIZARD_BLANKET, "free_text": "ผ้าห่ม "}
    token = (await _create(client, auth_headers, [_WIZARD_RICE, spaced]))["tracking_token"]
    couch_items = [
        {**_WIZARD_RICE, "reserved_qty": "5", "review_status": "approved"},
        {
            **spaced,
            "review_status": "rejected",
            "review_reason_code": "damaged",
            "review_reason": "ชำรุดเสียหาย",
        },
    ]

    response = await client.patch(
        f"/public/v1/donations/{token}/items",
        headers=auth_headers,
        json={
            "items": [
                _as_edit_form({**_WIZARD_RICE, "qty": "6"}),
                {**_as_edit_form(spaced), "free_text": "ผ้าห่ม"},
            ],
            "current_items": couch_items,
            "current_status": "verifying",
        },
    )

    body = response.json()
    assert [i["review_status"] for i in body["items"]] == ["approved", "rejected"]
    assert body["status"] == "verifying"
