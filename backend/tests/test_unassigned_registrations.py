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
    assert body["schema_v"] == 3

    stored = await UnassignedRegistration.get(body["id"])
    assert stored is not None
    assert stored.schema_v == 3
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


async def test_create_rejects_missing_address_when_housing_type_omitted(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(household={"pets": []}),
    )
    assert response.status_code == 422
    assert await UnassignedRegistration.count() == 0


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


async def test_create_persists_expanded_public_fields_schema_v3(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """#255 fields + schema_v 3 (pet claim lifecycle / persistent family)."""
    payload = _create_payload()
    payload["members"][0].update(
        {
            "nickname": "ชาย",
            "religion": "buddhist",
            "emergency_contact": {
                "name": "สมหญิง",
                "phone": "0899999999",
                "relation": "คู่สมรส",
            },
            "photo": "gfs:507f1f77bcf86cd799439011",
        }
    )
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=payload,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["schema_v"] == 3
    assert body["members"][0]["nickname"] == "ชาย"
    assert body["members"][0]["religion"] == "buddhist"
    assert body["members"][0]["emergency_contact"] == {
        "name": "สมหญิง",
        "phone": "0899999999",
        "relation": "คู่สมรส",
    }
    assert body["members"][0]["photo"] == "gfs:507f1f77bcf86cd799439011"

    stored = await UnassignedRegistration.get(body["id"])
    assert stored is not None
    assert stored.schema_v == 3
    assert stored.members[0].nickname == "ชาย"
    assert stored.members[0].emergency_contact is not None
    assert stored.members[0].emergency_contact.phone == "0899999999"


async def test_create_persists_pet_image_url(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """#255 pet photo — household.pets[].image_url stores GridFS ref."""
    payload = _create_payload(
        household={
            "housing_type": "owned_house",
            "address_no": "123/45",
            "subdistrict": "คอหงส์",
            "district": "หาดใหญ่",
            "province": "สงขลา",
            "postal_code": "90110",
            "pets": [
                {
                    "species": "dog",
                    "count": 1,
                    "has_cage": True,
                    "image_url": "gfs:507f1f77bcf86cd799439011",
                }
            ],
        }
    )
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=payload,
    )
    assert response.status_code == 201
    stored = await UnassignedRegistration.get(response.json()["id"])
    assert stored is not None
    assert len(stored.household.pets) == 1
    assert stored.household.pets[0].image_url == "gfs:507f1f77bcf86cd799439011"


async def test_create_rejects_invalid_pet_image_url(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload(
        household={
            "housing_type": "owned_house",
            "address_no": "123/45",
            "subdistrict": "คอหงส์",
            "district": "หาดใหญ่",
            "province": "สงขลา",
            "postal_code": "90110",
            "pets": [
                {
                    "species": "cat",
                    "count": 1,
                    "has_cage": False,
                    "image_url": "not-a-gridfs-ref",
                }
            ],
        }
    )
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=payload,
    )
    assert response.status_code == 422
    assert await UnassignedRegistration.count() == 0


async def test_create_omits_blank_emergency_contact(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload()
    payload["members"][0]["emergency_contact"] = {
        "name": "",
        "phone": "",
        "relation": "",
    }
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=payload,
    )
    assert response.status_code == 201
    stored = await UnassignedRegistration.get(response.json()["id"])
    assert stored is not None
    assert stored.members[0].emergency_contact is None


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
    anon = "ANON-01HTESTANON0000000000001"
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


async def test_residence_match_returns_non_pii_chips(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            household={
                "housing_type": "owned_house",
                "address_no": "55/1",
                "residence_landmark": "ใกล้ตลาด",
                "subdistrict": "คอหงส์",
                "district": "หาดใหญ่",
                "province": "สงขลา",
                "postal_code": "90110",
                "pets": [],
            }
        ),
    )
    assert created.status_code == 201
    reg_id = created.json()["id"]

    response = await client.post(
        "/public/v1/unassigned-registrations/residence-match",
        headers=auth_headers,
        json={
            "housing_type": "owned_house",
            "address_no": "55/1",
            "subdistrict": "คอหงส์",
            "district": "หาดใหญ่",
            "province": "สงขลา",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["matches"]) == 1
    hit = body["matches"][0]
    assert hit["id"] == reg_id
    assert hit["landmark"] == "ใกล้ตลาด"
    assert hit["housing_type"] == "owned_house"
    assert "members" not in hit
    assert "first_name" not in hit
    assert hit["member_count"] == 1
    assert hit["primary_contact_name_masked"] is not None


async def test_residence_match_widens_across_villages_when_query_omits_village_no(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Intentional (mirrors frontend `matchesResidenceAddress`, see
    registration-shell.test.ts "ignores village_no when the query omits it"):
    when the caller doesn't know/enter village_no, match widens across villages
    that otherwise share the same address_no/subdistrict/district/province.
    Locked in here as a regression, not a bug — do not tighten unilaterally."""
    same_address = {
        "housing_type": "owned_house",
        "address_no": "77/2",
        "subdistrict": "คอหงส์",
        "district": "หาดใหญ่",
        "province": "สงขลา",
        "postal_code": "90110",
        "pets": [],
    }
    first = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "หนึ่ง",
                    "last_name": "หมู่สอง",
                    "gender": "male",
                    "phone": "0810000001",
                    "person_id": {"cardType": "national_id", "number": "1000000000001"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ],
            household={**same_address, "village_no": "หมู่ 2"},
        ),
    )
    second = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "สอง",
                    "last_name": "หมู่เก้า",
                    "gender": "male",
                    "phone": "0810000002",
                    "person_id": {"cardType": "national_id", "number": "1000000000002"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ],
            household={**same_address, "village_no": "หมู่ 9"},
        ),
    )
    assert first.status_code == 201
    assert second.status_code == 201

    # No village_no in the query → both villages match (widen, by design).
    widened = await client.post(
        "/public/v1/unassigned-registrations/residence-match",
        headers=auth_headers,
        json=same_address,
    )
    assert widened.status_code == 200
    assert {m["id"] for m in widened.json()["matches"]} == {
        first.json()["id"],
        second.json()["id"],
    }

    # Explicit village_no in the query → only the matching village.
    narrowed = await client.post(
        "/public/v1/unassigned-registrations/residence-match",
        headers=auth_headers,
        json={**same_address, "village_no": "หมู่ 9"},
    )
    assert narrowed.status_code == 200
    assert {m["id"] for m in narrowed.json()["matches"]} == {second.json()["id"]}


async def test_residence_match_caps_at_25_results(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    same_address = {
        "housing_type": "owned_house",
        "address_no": "1/1",
        "subdistrict": "คอหงส์",
        "district": "หาดใหญ่",
        "province": "สงขลา",
        "postal_code": "90110",
        "pets": [],
    }
    for i in range(27):
        response = await client.post(
            "/public/v1/unassigned-registrations",
            headers=auth_headers,
            json=_create_payload(
                members=[
                    {
                        "first_name": f"คน{i}",
                        "last_name": "ทดสอบ",
                        "gender": "male",
                        "phone": f"08{i:08d}",
                        "person_id": {"cardType": "national_id", "number": f"{i:013d}"},
                        "country": "THAILAND",
                        "vulnerable_groups": [],
                        "special_needs": [],
                    }
                ],
                household=same_address,
            ),
        )
        assert response.status_code == 201

    matched = await client.post(
        "/public/v1/unassigned-registrations/residence-match",
        headers=auth_headers,
        json=same_address,
    )
    assert matched.status_code == 200
    assert len(matched.json()["matches"]) == 25


async def test_residence_match_by_member_phone(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "สมชาย",
                    "last_name": "ใจดี",
                    "gender": "male",
                    "phone": "0811111111",
                    "person_id": {"cardType": "national_id", "number": "1111111111111"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                },
                {
                    "first_name": "สมหญิง",
                    "last_name": "ใจดี",
                    "gender": "female",
                    "phone": "0899999999",
                    "person_id": {"cardType": "national_id", "number": "2222222222222"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                },
            ],
            household={
                "housing_type": "owned_house",
                "address_no": "123/45",
                "residence_landmark": "ข้างโรงเรียน",
                "subdistrict": "คอหงส์",
                "district": "หาดใหญ่",
                "province": "สงขลา",
                "postal_code": "90110",
                "pets": [{"species": "dog", "count": 2}],
            },
        ),
    )
    assert created.status_code == 201
    reg_id = created.json()["id"]

    # Search using member's phone (089-999-9999)
    response = await client.post(
        "/public/v1/unassigned-registrations/residence-match",
        headers=auth_headers,
        json={"phone": "089-999-9999"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["matches"]) == 1
    hit = body["matches"][0]
    assert hit["id"] == reg_id
    assert hit["member_count"] == 2
    assert "สมชาย" in hit["primary_contact_name_masked"]
    assert "คุณส***" in hit["matched_member_masked"]
    assert len(hit["pets"]) == 1
    assert hit["pets"][0]["species"] == "dog"


async def test_residence_match_by_phone_finds_closed_document(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """After full claim, open_phones is empty — match must still find the family by phone."""
    created = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            members=[
                {
                    "first_name": "สมชาย",
                    "last_name": "ใจดี",
                    "gender": "male",
                    "phone": "0812345678",
                    "person_id": {"cardType": "national_id", "number": "1111111111111"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ]
        ),
    )
    assert created.status_code == 201
    reg_id = created.json()["id"]

    stored = await UnassignedRegistration.get(reg_id)
    assert stored is not None
    stored.members[0].status = "claimed"
    stored.members[0].claimed_shelter_code = "SH001"
    stored.open_phones = []
    stored.status = "closed"
    await stored.save()

    response = await client.post(
        "/public/v1/unassigned-registrations/residence-match",
        headers=auth_headers,
        json={"phone": "0812345678"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["matches"]) == 1
    assert body["matches"][0]["id"] == reg_id
    assert body["matches"][0]["status"] == "closed"
    assert body["matches"][0]["claimed_shelter_code"] == "SH001"


async def test_join_appends_members_into_existing_reserved_household(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    first = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(),
    )
    assert first.status_code == 201
    first_body = first.json()
    reserved_hh = first_body["reserved_household_id"]

    second = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            join_registration_id=first_body["id"],
            members=[
                {
                    "first_name": "สมหญิง",
                    "last_name": "ใจดี",
                    "gender": "female",
                    "phone": "0899999999",
                    "person_id": {"cardType": "national_id", "number": "9876543210987"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ],
            household={
                "housing_type": "owned_house",
                "address_no": "123/45",
                "subdistrict": "คอหงส์",
                "district": "หาดใหญ่",
                "province": "สงขลา",
                "postal_code": "90110",
                "pets": [{"species": "dog", "count": 1}],
            },
        ),
    )
    assert second.status_code == 201
    second_body = second.json()
    assert second_body["id"] == first_body["id"]
    assert second_body["reserved_household_id"] == reserved_hh
    assert len(second_body["members"]) == 2

    stored = await UnassignedRegistration.get(first_body["id"])
    assert stored is not None
    assert len(stored.members) == 2
    assert stored.reserved_household_id == reserved_hh
    assert len(stored.household.pets) == 1
    assert stored.household.pets[0].species == "dog"


async def test_join_rejects_national_id_already_claimed_on_same_registration(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A joiner must not reuse an already-claimed member's identity on this doc (join-dedup gap)."""
    created = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(),
    )
    assert created.status_code == 201
    reg_id = created.json()["id"]

    stored = await UnassignedRegistration.get(reg_id)
    assert stored is not None
    stored.members[0].status = "claimed"
    stored.members[0].claimed_shelter_code = "SH001"
    stored.open_person_id_numbers = []
    stored.open_phones = []
    await stored.save()

    joined = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            join_registration_id=reg_id,
            members=[
                {
                    "first_name": "สมชาย",
                    "last_name": "ปลอม",
                    "gender": "male",
                    "phone": "0899999999",
                    # Same national_id as the already-claimed member[0].
                    "person_id": {"cardType": "national_id", "number": "1234567890123"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ],
        ),
    )
    assert joined.status_code == 409
    assert joined.json()["errors"][0]["error"] == "DUPLICATE_OPEN_IDENTITY"

    unchanged = await UnassignedRegistration.get(reg_id)
    assert unchanged is not None
    assert len(unchanged.members) == 1


async def test_join_rejects_phone_already_claimed_on_same_registration(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Same gap as above, via phone instead of national_id."""
    created = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(),
    )
    assert created.status_code == 201
    reg_id = created.json()["id"]

    stored = await UnassignedRegistration.get(reg_id)
    assert stored is not None
    stored.members[0].status = "claimed"
    stored.members[0].claimed_shelter_code = "SH001"
    stored.open_person_id_numbers = []
    stored.open_phones = []
    await stored.save()

    joined = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(
            join_registration_id=reg_id,
            members=[
                {
                    "first_name": "สมชาย",
                    "last_name": "ปลอม",
                    "gender": "male",
                    # Same phone as the already-claimed member[0] ("0812345678").
                    "phone": "0812345678",
                    "person_id": {"cardType": "national_id", "number": "9998887776665"},
                    "country": "THAILAND",
                    "vulnerable_groups": [],
                    "special_needs": [],
                }
            ],
        ),
    )
    assert joined.status_code == 409
    assert joined.json()["errors"][0]["error"] == "DUPLICATE_OPEN_IDENTITY"

    unchanged = await UnassignedRegistration.get(reg_id)
    assert unchanged is not None
    assert len(unchanged.members) == 1


async def test_join_target_not_found_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(join_registration_id=new_ulid()),
    )
    assert response.status_code == 404
    assert response.json()["errors"][0]["error"] == "JOIN_TARGET_NOT_FOUND"


# --------------------------------------------------------------- CR-148 FR-18

_DORM_HOUSEHOLD: dict = {
    "housing_type": "apartment_dorm",
    "address_no": "305 หอสุขใจ อาคาร B ชั้น 3",
    "subdistrict": "คอหงส์",
    "district": "หาดใหญ่",
    "province": "สงขลา",
    "postal_code": "90110",
    "pets": [],
}


async def test_create_round_trips_cr148_member_fields(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload()
    payload["members"][0].update(
        {
            "religion": "other",
            "religion_other": "  ซิกข์  ",
            "vulnerable_groups": ["disability_other"],
            "disability_other_detail": " ไม่ได้ยินข้างซ้าย ",
        }
    )
    response = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=payload
    )
    assert response.status_code == 201
    body = response.json()
    assert body["members"][0]["religion_other"] == "ซิกข์"
    assert body["members"][0]["disability_other_detail"] == "ไม่ได้ยินข้างซ้าย"

    stored = await UnassignedRegistration.get(body["id"])
    assert stored is not None
    assert stored.members[0].religion_other == "ซิกข์"
    assert stored.members[0].disability_other_detail == "ไม่ได้ยินข้างซ้าย"


async def test_create_drops_orphan_cr148_member_details(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload()
    payload["members"][0].update(
        {
            "religion": "buddhist",
            "religion_other": "ซิกข์",
            "vulnerable_groups": ["elderly"],
            "disability_other_detail": "ไม่ได้ยิน",
        }
    )
    response = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=payload
    )
    assert response.status_code == 201
    body = response.json()
    assert body["members"][0]["religion_other"] is None
    assert body["members"][0]["disability_other_detail"] is None
    stored = await UnassignedRegistration.get(body["id"])
    assert stored is not None
    assert stored.members[0].religion_other is None
    assert stored.members[0].disability_other_detail is None


async def test_create_rejects_religion_other_over_60_chars(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload()
    payload["members"][0].update({"religion": "other", "religion_other": "ก" * 61})
    response = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=payload
    )
    assert response.status_code == 422
    assert await UnassignedRegistration.count() == 0


async def test_create_persists_dorm_fields_for_apartment_dorm(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    household = {
        **_DORM_HOUSEHOLD,
        "dorm_name": " หอสุขใจ ",
        "dorm_building": "B",
        "dorm_floor": "3",
        "dorm_room": "305",
    }
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(household=household),
    )
    assert response.status_code == 201
    stored = await UnassignedRegistration.get(response.json()["id"])
    assert stored is not None
    assert stored.household.dorm_name == "หอสุขใจ"
    assert stored.household.dorm_building == "B"
    assert stored.household.dorm_floor == "3"
    assert stored.household.dorm_room == "305"


@pytest.mark.parametrize("missing", ["dorm_name", "dorm_room"])
async def test_create_rejects_apartment_dorm_without_required_dorm_fields(
    client: AsyncClient, auth_headers: dict[str, str], missing: str
) -> None:
    household = {**_DORM_HOUSEHOLD, "dorm_name": "หอสุขใจ", "dorm_room": "305"}
    household[missing] = "   "
    response = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json=_create_payload(household=household),
    )
    assert response.status_code == 422
    assert await UnassignedRegistration.count() == 0


async def test_create_clears_dorm_fields_for_other_housing_types(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload()
    payload["household"].update(
        {"dorm_name": "หอสุขใจ", "dorm_building": "B", "dorm_floor": "3", "dorm_room": "305"}
    )
    response = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=payload
    )
    assert response.status_code == 201
    stored = await UnassignedRegistration.get(response.json()["id"])
    assert stored is not None
    hh = stored.household
    assert (hh.dorm_name, hh.dorm_building, hh.dorm_floor, hh.dorm_room) == (
        None,
        None,
        None,
        None,
    )


async def test_create_rejects_pet_total_over_10(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload()
    payload["household"]["pets"] = [{"species": "dog", "count": 6}, {"species": "cat", "count": 5}]
    response = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=payload
    )
    assert response.status_code == 422
    assert await UnassignedRegistration.count() == 0


async def test_create_rejects_pet_row_count_over_10(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload()
    payload["household"]["pets"] = [{"species": "dog", "count": 11}]
    response = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=payload
    )
    assert response.status_code == 422


async def test_create_allows_pet_total_of_exactly_10(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = _create_payload()
    payload["household"]["pets"] = [{"species": "dog", "count": 1} for _ in range(10)]
    response = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=payload
    )
    assert response.status_code == 201


async def test_join_rejects_pets_pushing_household_over_10(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    first_payload = _create_payload()
    first_payload["household"]["pets"] = [{"species": "dog", "count": 1} for _ in range(9)]
    first = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=first_payload
    )
    assert first.status_code == 201

    join_payload = _create_payload(join_registration_id=first.json()["id"])
    join_payload["members"][0].update(
        {
            "first_name": "สมหญิง",
            "phone": "0899999999",
            "person_id": {"cardType": "national_id", "number": "9876543210987"},
        }
    )
    join_payload["household"]["pets"] = [{"species": "cat", "count": 1} for _ in range(2)]
    joined = await client.post(
        "/public/v1/unassigned-registrations", headers=auth_headers, json=join_payload
    )
    assert joined.status_code == 422
    assert joined.json()["errors"][0]["error"] == "PETS_LIMIT_EXCEEDED"
    stored = await UnassignedRegistration.get(first.json()["id"])
    assert stored is not None
    assert len(stored.household.pets) == 9
    assert len(stored.members) == 1
