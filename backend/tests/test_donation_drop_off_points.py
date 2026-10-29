"""CR-206 — a drop-off point per line (FR-MP-2..FR-MP-4, FR-MP-2a) and point receipts on GET."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from httpx import AsyncClient
from tent_model.donation_buffer import DonationBuffer
from tent_model.donation_need_counter import DonationNeedCounter
from tent_model.donation_need_counter_ops import seed_counter
from tent_model.public_donation import DonationPointReceipt, PublicDonation
from tent_model.public_shelter import DonationPoint, GeoPoint, PublicShelter

from apiapp.utils.masking import sha256_hex

_GYM = "01JGYM000000000000000000GY"
_MED = "01JMED000000000000000000MD"

_WATER = {"item_id": "item:water", "free_text": "น้ำดื่ม", "qty": "24", "unit": "ขวด"}
_PARA = {"free_text": "ยาพารา", "qty": "10", "unit": "แผง"}


def _point(point_id: str, name: str) -> DonationPoint:
    return DonationPoint(id=point_id, name=name, geo=GeoPoint(lat=13.7, lng=100.5))


async def _shelter(points: list[DonationPoint]) -> PublicShelter:
    return await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="Test Shelter",
        status="open",
        capacity=100,
        donation_points=points,
        updated_at=datetime.now(UTC),
    ).insert()


@pytest.fixture
async def two_point_shelter() -> PublicShelter:
    return await _shelter([_point(_GYM, "โรงยิม"), _point(_MED, "ห้องพยาบาล")])


async def _post(
    client: AsyncClient,
    headers: dict[str, str],
    items: list[dict],
    *,
    delivery_method: str = "self_dropoff",
):
    return await client.post(
        "/public/v1/donations",
        headers=headers,
        json={
            "shelter_code": "SH001",
            "campaign_id": "donation_campaign:c1",
            "donor": {"name": "Donor", "phone": "0812345678"},
            "items": items,
            "logistics": {"delivery_method": delivery_method},
        },
    )


async def _buffer(token: str) -> DonationBuffer:
    buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == sha256_hex(token))
    assert buffer is not None
    return buffer


async def _reserved(item_id: str = "item:water") -> Decimal:
    counter = await DonationNeedCounter.find_one(
        DonationNeedCounter.shelter_code == "SH001",
        DonationNeedCounter.item_id == item_id,
    )
    assert counter is not None
    return counter.reserved_qty


async def test_ac1_each_line_keeps_its_point(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    response = await _post(
        client,
        auth_headers,
        [{**_WATER, "drop_off_point_id": _GYM}, {**_PARA, "drop_off_point_id": _MED}],
    )

    assert response.status_code == 201, response.text
    token = response.json()["tracking_token"]
    buffer = await _buffer(token)
    assert [line.get("drop_off_point_id") for line in buffer.items_declared] == [_GYM, _MED]

    tracked = (await client.get(f"/public/v1/donations/{token}", headers=auth_headers)).json()
    assert [line["drop_off_point_id"] for line in tracked["donation"]["items"]] == [_GYM, _MED]
    assert tracked["donation"]["point_receipts"] == []


async def test_a_line_without_a_point_stays_without_one(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    response = await _post(client, auth_headers, [_PARA])

    assert response.status_code == 201, response.text
    buffer = await _buffer(response.json()["tracking_token"])
    assert buffer.items_declared[0].get("drop_off_point_id") is None


async def test_ac2_an_unknown_point_is_refused_and_quota_does_not_move(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await seed_counter(
        shelter_code="SH001",
        campaign_id="donation_campaign:c1",
        item_id="item:water",
        qty_target=Decimal("100"),
        now=datetime.now(UTC),
    )

    response = await _post(
        client,
        auth_headers,
        # The good line first: it would have reserved before the bad one was reached.
        [{**_WATER, "drop_off_point_id": _GYM}, {**_PARA, "drop_off_point_id": "elsewhere"}],
    )

    assert response.status_code == 400
    error = response.json()["errors"][0]
    assert error["error"] == "UNKNOWN_DROP_OFF_POINT"
    assert error["drop_off_point_id"] == "elsewhere"
    assert await _reserved() == Decimal("0")
    assert await DonationBuffer.find_all().count() == 0
    assert await PublicDonation.find_all().count() == 0


async def test_ac3_a_shelter_without_points_refuses_any_point(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _shelter([])

    response = await _post(client, auth_headers, [{**_PARA, "drop_off_point_id": _GYM}])

    assert response.status_code == 400
    assert response.json()["errors"][0]["error"] == "UNKNOWN_DROP_OFF_POINT"


@pytest.mark.parametrize("delivery_method", ["parcel", "shelter_pickup"])
async def test_ac4_pickup_and_parcel_lines_carry_no_point(
    client: AsyncClient,
    two_point_shelter: PublicShelter,
    auth_headers: dict[str, str],
    delivery_method: str,
) -> None:
    response = await _post(
        client,
        auth_headers,
        # Not refused even for an id the shelter does not offer: it is dropped either way.
        [{**_WATER, "drop_off_point_id": _GYM}, {**_PARA, "drop_off_point_id": "elsewhere"}],
        delivery_method=delivery_method,
    )

    assert response.status_code == 201, response.text
    token = response.json()["tracking_token"]
    buffer = await _buffer(token)
    assert [line.get("drop_off_point_id") for line in buffer.items_declared] == [None, None]
    tracked = (await client.get(f"/public/v1/donations/{token}", headers=auth_headers)).json()
    assert [line["drop_off_point_id"] for line in tracked["donation"]["items"]] == [None, None]


async def _edit(client: AsyncClient, headers: dict[str, str], token: str, items: list[dict]):
    return await client.patch(
        f"/public/v1/donations/{token}/items", headers=headers, json={"items": items}
    )


async def test_fr_mp_2a_an_edit_drops_a_point_no_longer_offered(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    created = await _post(client, auth_headers, [{**_PARA, "drop_off_point_id": _MED}])
    token = created.json()["tracking_token"]
    # Staff untick the infirmary after the booking (AC-13).
    two_point_shelter.donation_points = [_point(_GYM, "โรงยิม")]
    await two_point_shelter.save()

    response = await _edit(
        client,
        auth_headers,
        token,
        [
            {**_PARA, "qty": "12", "drop_off_point_id": _MED},
            {"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน", "drop_off_point_id": _GYM},
        ],
    )

    assert response.status_code == 200, response.text
    assert [line.get("drop_off_point_id") for line in response.json()["items"]] == [None, _GYM]
    buffer = await _buffer(token)
    assert [line.get("drop_off_point_id") for line in buffer.items_declared] == [None, _GYM]
    stub = await PublicDonation.find_one(PublicDonation.tracking_token_hash == sha256_hex(token))
    assert stub is not None
    assert [line.drop_off_point_id for line in stub.items_declared] == [None, _GYM]


async def test_fr_mp_4_an_edit_of_a_parcel_booking_carries_no_point(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    created = await _post(client, auth_headers, [_PARA], delivery_method="parcel")
    token = created.json()["tracking_token"]

    response = await _edit(client, auth_headers, token, [{**_PARA, "drop_off_point_id": _GYM}])

    assert response.status_code == 200, response.text
    assert response.json()["items"][0].get("drop_off_point_id") is None


async def test_tracking_reports_point_receipts_reduced(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    created = await _post(
        client,
        auth_headers,
        [{**_WATER, "drop_off_point_id": _GYM}, {**_PARA, "drop_off_point_id": _MED}],
    )
    token = created.json()["tracking_token"]
    stub = await PublicDonation.find_one(PublicDonation.tracking_token_hash == sha256_hex(token))
    assert stub is not None
    stub.point_receipts = [
        DonationPointReceipt(point_id=_GYM, line_nos=[0], received_at="2026-10-28T02:12:00.000Z")
    ]
    await stub.save()

    tracked = (await client.get(f"/public/v1/donations/{token}", headers=auth_headers)).json()

    assert tracked["donation"]["point_receipts"] == [
        {"point_id": _GYM, "line_nos": [0], "received_at": "2026-10-28T02:12:00.000Z"}
    ]
