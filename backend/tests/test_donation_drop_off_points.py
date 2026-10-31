"""CR-206 / staff-assigned drop-off — a drop-off point per line and point receipts on GET."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.donation_buffer import DonationBuffer
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


async def test_ac7_a_point_the_projection_has_not_caught_up_with_is_accepted(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    new_point = "point-just-added"
    assert new_point not in {point.id for point in two_point_shelter.donation_points}

    response = await _post(client, auth_headers, [{**_PARA, "drop_off_point_id": new_point}])

    assert response.status_code == 201, response.text
    buffer = await _buffer(response.json()["tracking_token"])
    assert buffer.items_declared[0]["drop_off_point_id"] == new_point


async def test_a_shelter_without_points_still_books(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _shelter([])

    response = await _post(client, auth_headers, [{**_PARA, "drop_off_point_id": _GYM}])

    assert response.status_code == 201, response.text


async def test_fr_ap_8a_response_items_follow_request_order_with_stored_values(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    response = await _post(
        client, auth_headers, [_PARA, {**_WATER, "drop_off_point_id": _GYM}, {**_PARA}]
    )

    assert response.status_code == 201, response.text
    assert response.json()["items"] == [
        {"drop_off_point_id": None, "review_status": "pending"},
        {"drop_off_point_id": _GYM, "review_status": "pending"},
        {"drop_off_point_id": None, "review_status": "pending"},
    ]


async def test_fr_ap_8a_response_items_are_null_for_a_parcel(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    response = await _post(
        client, auth_headers, [{**_WATER, "drop_off_point_id": _GYM}], delivery_method="parcel"
    )

    assert response.json()["items"] == [{"drop_off_point_id": None, "review_status": "pending"}]


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


async def test_fr_mp_2a_an_edit_trusts_the_bffs_points_over_the_lagging_projection(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The edit path is BFF-only (Bearer secret, not under /external): the BFF has already
    checked each point against the CouchDB shelter doc. A point staff added there that the
    worker has not projected into Mongo yet must not be nulled here."""
    created = await _post(client, auth_headers, [{**_PARA, "drop_off_point_id": _MED}])
    token = created.json()["tracking_token"]
    new_point = "point-just-added"
    assert new_point not in {point.id for point in two_point_shelter.donation_points}

    response = await _edit(
        client,
        auth_headers,
        token,
        [
            {**_PARA, "qty": "12", "drop_off_point_id": new_point},
            {"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน", "drop_off_point_id": _GYM},
            {"free_text": "นม", "qty": "1", "unit": "กล่อง", "drop_off_point_id": None},
        ],
    )

    assert response.status_code == 200, response.text
    expected = [new_point, _GYM, None]
    assert [line.get("drop_off_point_id") for line in response.json()["items"]] == expected
    buffer = await _buffer(token)
    assert [line.get("drop_off_point_id") for line in buffer.items_declared] == expected
    stub = await PublicDonation.find_one(PublicDonation.tracking_token_hash == sha256_hex(token))
    assert stub is not None
    assert [line.drop_off_point_id for line in stub.items_declared] == expected


async def _held_keys(token: str) -> list[str]:
    return [line["line_key"] for line in (await _buffer(token)).items_declared]


async def test_ac14_an_edit_keeps_the_held_point_whatever_the_request_sends(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    created = await _post(client, auth_headers, [{**_WATER, "drop_off_point_id": _GYM}, _PARA])
    token = created.json()["tracking_token"]
    water_key, para_key = await _held_keys(token)

    response = await _edit(
        client,
        auth_headers,
        token,
        [
            # item_id omitted: it comes back from the held line, so the line is unchanged.
            {
                **{k: v for k, v in _WATER.items() if k != "item_id"},
                "qty": "30",
                "line_key": water_key,
                "drop_off_point_id": _MED,
            },
            {**_PARA, "line_key": para_key, "drop_off_point_id": _MED},
            {"free_text": "นม", "qty": "1", "unit": "กล่อง", "drop_off_point_id": _MED},
        ],
    )

    assert response.status_code == 200, response.text
    assert [line.get("drop_off_point_id") for line in response.json()["items"]] == [
        _GYM,
        None,
        _MED,
    ]
    buffer = await _buffer(token)
    assert [line.get("drop_off_point_id") for line in buffer.items_declared] == [_GYM, None, _MED]


async def test_ac14_a_request_that_clears_the_point_does_not_clear_the_held_one(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    created = await _post(client, auth_headers, [{**_PARA, "drop_off_point_id": _GYM}])
    token = created.json()["tracking_token"]
    (key,) = await _held_keys(token)

    response = await _edit(
        client, auth_headers, token, [{**_PARA, "line_key": key, "drop_off_point_id": None}]
    )

    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["drop_off_point_id"] == _GYM


async def test_ac14a_a_changed_item_id_takes_the_requests_point(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    created = await _post(client, auth_headers, [{**_PARA, "drop_off_point_id": _GYM}])
    token = created.json()["tracking_token"]
    (key,) = await _held_keys(token)

    response = await _edit(
        client,
        auth_headers,
        token,
        [{**_PARA, "item_id": "item:blanket", "line_key": key, "drop_off_point_id": _MED}],
    )

    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["drop_off_point_id"] == _MED


async def test_ac15_a_held_line_without_a_point_stays_without_one(
    client: AsyncClient, two_point_shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    created = await _post(client, auth_headers, [_PARA])
    token = created.json()["tracking_token"]
    (key,) = await _held_keys(token)

    response = await _edit(
        client, auth_headers, token, [{**_PARA, "line_key": key, "drop_off_point_id": _GYM}]
    )

    assert response.status_code == 200, response.text
    assert response.json()["items"][0].get("drop_off_point_id") is None


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
