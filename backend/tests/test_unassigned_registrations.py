"""CR-113 — public create Unassigned Registration (Mongo-only)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.unassigned_registration import UnassignedRegistration

from apiapp.core.config import Settings
from apiapp.modules.shelter.use_case import FORECAST_OCCUPANCY_STATUSES
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
        occupancy_total=7,
        updated_at=datetime.now(UTC),
        raw_data={"operation_status": "active", "capacity": 100},
    )
    await shelter.insert()
    return shelter


def _create_payload(**overrides: object) -> dict:
    body: dict = {
        "members": [
            {
                "first_name": "สมชาย",
                "last_name": "ใจดี",
                "gender": "male",
                "phone": "0812345678",
                "person_id": {"cardType": "national_id", "number": "1234567890123"},
                "country": "THAILAND",
                "vulnerable_groups": [],
                "special_needs": [],
            }
        ],
        "household": {
            "housing_type": "owned_house",
            "address_no": "123/45",
            "subdistrict": "คอหงส์",
            "district": "หาดใหญ่",
            "province": "สงขลา",
            "postal_code": "90110",
            "pets": [],
        },
        "registered_via": "web",
    }
    body.update(overrides)
    return body


async def _forecast_occupancy(client: AsyncClient, auth_headers: dict[str, str]) -> int:
    """CR-112 Forecast = public shelter `occupancy` (PublicPerson stay allow-list)."""
    response = await client.get("/public/v1/shelters/SH001", headers=auth_headers)
    assert response.status_code == 200
    return int(response.json()["shelter"]["occupancy"])


async def test_create_requires_bearer(client: AsyncClient) -> None:
    response = await client.post("/public/v1/unassigned-registrations", json=_create_payload())
    assert response.status_code == 401


async def test_create_persists_mongo_only_with_reserved_ids(
    client: AsyncClient,
    auth_headers: dict[str, str],
    open_shelter: PublicShelter,
) -> None:
    # Seed a Forecast occupant so occupancy is derived from PublicPerson (CR-112),
    # not the legacy denormalized occupancy_total field.
    await PublicPerson(
        id="evacuee:seed-forecast",
        shelter_code="SH001",
        first_name="มีอยู่แล้ว",
        last_name_masked="ม.",
        status="pre_registered",
        updated_at=datetime.now(UTC),
    ).insert()
    forecast_before = await _forecast_occupancy(client, auth_headers)
    assert forecast_before == 1
    assert open_shelter.occupancy_total == 7  # denormalized field is not Forecast

    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["id"]
    assert body["reserved_household_id"].startswith("household:")
    assert len(body["members"]) == 1
    reserved_evacuee = body["members"][0]["reserved_evacuee_id"]
    assert reserved_evacuee.startswith("evacuee:")
    assert body["members"][0]["status"] == "open"
    assert body["registered_via"] == "web"
    assert body["schema_v"] == 1

    stored = await UnassignedRegistration.get(body["id"])
    assert stored is not None
    assert stored.schema_v == 1
    assert stored.reserved_household_id == body["reserved_household_id"]
    assert stored.members[0].status == "open"
    assert stored.members[0].reserved_evacuee_id == reserved_evacuee
    assert stored.members[0].first_name == "สมชาย"
    assert stored.members[0].person_id is not None
    assert stored.members[0].person_id.number == "1234567890123"
    assert stored.registered_via == "web"
    assert stored.household.housing_type == "owned_house"

    # FR-UR-01: no public_persons stub until claim + worker project from Couch.
    # FastAPI create never writes Couch; reserved ids must not appear as projections.
    assert await PublicPerson.get(reserved_evacuee) is None
    assert await PublicPerson.get(body["reserved_household_id"]) is None
    assert await PublicPerson.count() == 1  # only the seeded Forecast person

    # FR-UR-06: Forecast Occupancy (CR-112 `occupancy`) unchanged for every shelter.
    assert await _forecast_occupancy(client, auth_headers) == forecast_before
    assert (
        await PublicPerson.find(
            {"shelter_code": "SH001", "status": {"$in": list(FORECAST_OCCUPANCY_STATUSES)}}
        ).count()
        == forecast_before
    )


async def test_create_rejects_homeless_without_landmark_or_geo(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            household={
                "housing_type": "homeless",
                "residence_landmark": "  ",
                "pets": [],
            }
        ),
    )
    assert response.status_code == 422
    assert await UnassignedRegistration.count() == 0


async def test_create_allows_homeless_with_landmark(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            household={
                "housing_type": "homeless",
                "residence_landmark": "ใต้สะพาน",
                "pets": [],
            }
        ),
    )
    assert response.status_code == 201
    stored = await UnassignedRegistration.get(response.json()["id"])
    assert stored is not None
    assert stored.household.housing_type == "homeless"
    assert stored.household.residence_landmark == "ใต้สะพาน"


async def test_create_rejects_non_homeless_without_address(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            household={
                "housing_type": "owned_house",
                "pets": [],
            }
        ),
    )
    assert response.status_code == 422
    assert await UnassignedRegistration.count() == 0


async def test_create_rejects_duplicate_open_national_id(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    first = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(),
    )
    assert first.status_code == 201

    second = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "สมหญิง",
                    "last_name": "ใจดี",
                    "gender": "female",
                    "phone": "0899999999",
                    "person_id": {"cardType": "national_id", "number": "1234567890123"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert second.status_code == 409
    assert second.json()["errors"][0]["error"] == "DUPLICATE_OPEN_IDENTITY"
    assert await UnassignedRegistration.count() == 1


async def test_create_rejects_duplicate_open_phone(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    first = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(),
    )
    assert first.status_code == 201

    second = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "สมหญิง",
                    "last_name": "ใจดี",
                    "gender": "female",
                    "phone": "0812345678",
                    "person_id": {"cardType": "national_id", "number": "9876543210987"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert second.status_code == 409
    assert second.json()["errors"][0]["error"] == "DUPLICATE_OPEN_IDENTITY"
    assert await UnassignedRegistration.count() == 1


async def test_create_rejects_duplicate_open_passport(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    first = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "Alex",
                    "last_name": "Lee",
                    "gender": "male",
                    "phone": "0812222222",
                    "person_id": {"cardType": "passport", "number": "AB1234567"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert first.status_code == 201

    second = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "Other",
                    "last_name": "Lee",
                    "gender": "female",
                    "phone": "0813333333",
                    "person_id": {"cardType": "passport", "number": "ab1234567"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert second.status_code == 409
    assert second.json()["errors"][0]["error"] == "DUPLICATE_OPEN_IDENTITY"


async def test_create_rejects_duplicate_open_anonymous_id(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    anon = f"ANON-{new_ulid()}"
    first = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "A",
                    "last_name": "",
                    "gender": "other",
                    "phone": "0814444444",
                    "person_id": {"cardType": "anonymous", "number": anon},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert first.status_code == 201

    second = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "B",
                    "last_name": "",
                    "gender": "other",
                    "phone": "0815555555",
                    "person_id": {"cardType": "anonymous", "number": anon},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert second.status_code == 409
    assert second.json()["errors"][0]["error"] == "DUPLICATE_OPEN_IDENTITY"


async def test_create_rejects_duplicate_identity_within_same_request(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "สมชาย",
                    "last_name": "หนึ่ง",
                    "gender": "male",
                    "phone": "0816666666",
                    "person_id": {"cardType": "national_id", "number": "1111111111111"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                },
                {
                    "first_name": "สมหญิง",
                    "last_name": "สอง",
                    "gender": "female",
                    "phone": "0817777777",
                    "person_id": {"cardType": "national_id", "number": "1111111111111"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                },
            ]
        ),
    )
    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "DUPLICATE_OPEN_IDENTITY"
    assert await UnassignedRegistration.count() == 0


async def test_create_mints_anonymous_id_when_card_type_anonymous(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "ไม่ระบุ",
                    "last_name": "",
                    "gender": "other",
                    "phone": "0811111111",
                    "person_id": {"cardType": "anonymous"},
                    "country": "THAILAND",
                    "vulnerable_groups": ["elderly"],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert response.status_code == 201
    member = response.json()["members"][0]
    assert member["person_id"]["cardType"] == "anonymous"
    assert member["person_id"]["number"].startswith("ANON-")
    assert len(member["person_id"]["number"].removeprefix("ANON-")) == 26


async def test_create_rejects_anonymous_number_that_is_not_anon_ulid(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "ไม่ระบุ",
                    "last_name": "",
                    "gender": "other",
                    "phone": "0811111112",
                    "person_id": {"cardType": "anonymous", "number": "NOT-AN-ANON-ID"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["error"] == "INVALID_ANONYMOUS_ID"
    assert await UnassignedRegistration.count() == 0
