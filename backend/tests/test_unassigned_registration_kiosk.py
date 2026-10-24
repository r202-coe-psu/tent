"""Kiosk lookup of an Unassigned Registration family (service secret, no PII)."""

from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedRegistration,
)

from apiapp.utils.ulid import new_ulid

_URL = "/public/v1/unassigned-registrations/kiosk-lookup"


async def _seed_family() -> UnassignedRegistration:
    """Two open members (distinct person ids) and one member already claimed into SH001."""
    members = [
        UnassignedMember(
            reserved_evacuee_id=f"evacuee:{new_ulid()}",
            status="open",
            first_name="สมชาย",
            last_name="ใจดี",
            gender="male",
            age=41,
            phone="0812345678",
            person_id=PersonId(cardType="national_id", number="1234567890123"),
            photo="gfs:507f1f77bcf86cd799439011",
        ),
        UnassignedMember(
            reserved_evacuee_id=f"evacuee:{new_ulid()}",
            status="open",
            first_name="สมหญิง",
            last_name="ใจดี",
            gender="female",
            age=38,
            phone="0898765432",
            person_id=PersonId(cardType="national_id", number="9876543210987"),
        ),
        UnassignedMember(
            reserved_evacuee_id=f"evacuee:{new_ulid()}",
            status="claimed",
            first_name="เด็กชายดี",
            last_name="ใจดี",
            gender="male",
            age=7,
            claimed_shelter_code="SH001",
            claimed_by="kiosk:kiosk-1",
        ),
    ]
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=3,
        reserved_household_id=f"household:{new_ulid()}",
        members=members,
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="123/45",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            label="ครอบครัวใจดี",
        ),
        status="open",
        registered_via="web",
        created_at=datetime.now(UTC),
        open_person_id_numbers=["1234567890123", "9876543210987"],
        open_phones=["0812345678", "0898765432"],
    )
    await doc.insert()
    return doc


async def test_kiosk_lookup_by_registration_id_returns_whole_family(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    response = await client.post(_URL, json={"registration_id": doc.id}, headers=auth_headers)
    assert response.status_code == 200
    first, second, claimed = (m.reserved_evacuee_id for m in doc.members)
    assert response.json() == {
        "registration_id": doc.id,
        "reserved_household_id": doc.reserved_household_id,
        "members": [
            {
                "reserved_evacuee_id": first,
                "first_name": "สมชาย",
                "last_name": "ใจดี",
                "gender": "male",
                "age": 41,
                "status": "open",
                "claimed_shelter_code": None,
                "matched": False,
            },
            {
                "reserved_evacuee_id": second,
                "first_name": "สมหญิง",
                "last_name": "ใจดี",
                "gender": "female",
                "age": 38,
                "status": "open",
                "claimed_shelter_code": None,
                "matched": False,
            },
            {
                "reserved_evacuee_id": claimed,
                "first_name": "เด็กชายดี",
                "last_name": "ใจดี",
                "gender": "male",
                "age": 7,
                "status": "claimed",
                "claimed_shelter_code": "SH001",
                "matched": False,
            },
        ],
    }


async def test_kiosk_lookup_by_citizen_id_marks_the_open_member_matched(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    response = await client.post(_URL, json={"citizen_id": "9876543210987"}, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["registration_id"] == doc.id
    matched = {m["reserved_evacuee_id"]: m["matched"] for m in body["members"]}
    assert matched == {
        doc.members[0].reserved_evacuee_id: False,
        doc.members[1].reserved_evacuee_id: True,
        doc.members[2].reserved_evacuee_id: False,
    }


async def test_kiosk_lookup_by_evacuee_id_finds_claimed_member_with_its_shelter(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    claimed_id = doc.members[2].reserved_evacuee_id
    response = await client.post(_URL, json={"evacuee_id": claimed_id}, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["registration_id"] == doc.id
    hit = [m for m in body["members"] if m["matched"]]
    assert [(m["reserved_evacuee_id"], m["status"], m["claimed_shelter_code"]) for m in hit] == [
        (claimed_id, "claimed", "SH001")
    ]


async def test_kiosk_lookup_unknown_id_is_404_not_found(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(_URL, json={"registration_id": new_ulid()}, headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["errors"][0]["error"]["code"] == "NOT_FOUND"


async def test_kiosk_lookup_requires_service_bearer(client: AsyncClient) -> None:
    response = await client.post(_URL, json={"registration_id": new_ulid()})
    assert response.status_code == 401


async def test_kiosk_lookup_members_expose_no_contact_or_identity_fields(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    response = await client.post(_URL, json={"registration_id": doc.id}, headers=auth_headers)
    assert response.status_code == 200
    keys = {key for member in response.json()["members"] for key in member}
    assert keys.isdisjoint({"phone", "person_id", "photo"})
