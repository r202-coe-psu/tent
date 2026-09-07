"""CR-113 / #245 — staff search open Unassigned Registrations (FastAPI seam)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedRegistration,
)

from apiapp.core.staff_session import StaffSession, require_registration_staff
from apiapp.utils.ulid import new_ulid


@pytest.fixture
def staff_session() -> StaffSession:
    return StaffSession(
        name="reg.staff",
        roles=["shelter:SH001", "SH001:registration_staff"],
        shelter_code="SH001",
        is_sa=False,
    )


@pytest.fixture
async def authed_client(client: AsyncClient, app, staff_session: StaffSession):
    app.dependency_overrides[require_registration_staff] = lambda: staff_session
    yield client
    app.dependency_overrides.pop(require_registration_staff, None)


async def _seed_registration(
    *,
    open_first: str = "สมชาย",
    open_phone: str = "0812345678",
    open_national_id: str = "1234567890123",
    claimed_first: str | None = None,
) -> UnassignedRegistration:
    members: list[UnassignedMember] = [
        UnassignedMember(
            reserved_evacuee_id=f"evacuee:{new_ulid()}",
            status="open",
            first_name=open_first,
            last_name="ใจดี",
            gender="male",
            phone=open_phone,
            person_id=PersonId(cardType="national_id", number=open_national_id),
            country="THAILAND",
        )
    ]
    open_ids = [open_national_id]
    open_phones = [open_phone]
    if claimed_first:
        members.append(
            UnassignedMember(
                reserved_evacuee_id=f"evacuee:{new_ulid()}",
                status="claimed",
                first_name=claimed_first,
                last_name="ถูกเคลม",
                gender="female",
                phone="0899999999",
                person_id=PersonId(cardType="national_id", number="9876543210987"),
                country="THAILAND",
            )
        )
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=1,
        reserved_household_id=f"household:{new_ulid()}",
        members=members,
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="1",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
        ),
        status="open",
        registered_via="web",
        created_at=datetime.now(UTC),
        open_person_id_numbers=open_ids,
        open_phones=open_phones,
    )
    await doc.insert()
    return doc


async def test_search_requires_staff_session(client: AsyncClient) -> None:
    response = await client.get("/staff/v1/unassigned-registrations/search", params={"q": "สมชาย"})
    assert response.status_code == 401
    body = response.json()
    assert body["errors"][0]["error"]["code"] == "UNAUTHENTICATED"


async def test_search_rejects_bearer_external_secret(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Staff search must not accept public-plane EXTERNAL_API_SECRET."""
    response = await client.get(
        "/staff/v1/unassigned-registrations/search",
        params={"q": "สมชาย"},
        headers=auth_headers,
    )
    assert response.status_code == 401


async def test_search_finds_open_members_by_name_phone_and_national_id(
    authed_client: AsyncClient,
) -> None:
    doc = await _seed_registration()

    by_name = await authed_client.get(
        "/staff/v1/unassigned-registrations/search", params={"q": "สมชาย"}
    )
    assert by_name.status_code == 200
    name_hits = by_name.json()["results"]
    assert len(name_hits) == 1
    assert name_hits[0]["id"] == doc.id
    assert name_hits[0]["open_members"][0]["first_name"] == "สมชาย"
    assert name_hits[0]["open_members"][0]["status"] == "open"
    assert all(m["status"] == "open" for m in name_hits[0]["open_members"])

    by_phone = await authed_client.get(
        "/staff/v1/unassigned-registrations/search", params={"q": "0812345678"}
    )
    assert by_phone.status_code == 200
    assert by_phone.json()["results"][0]["id"] == doc.id

    by_nid = await authed_client.get(
        "/staff/v1/unassigned-registrations/search", params={"q": "1234567890123"}
    )
    assert by_nid.status_code == 200
    assert by_nid.json()["results"][0]["id"] == doc.id


async def test_search_does_not_offer_claimed_members_as_hits(
    authed_client: AsyncClient,
) -> None:
    doc = await _seed_registration(claimed_first="สมหญิง")

    # Claimed member name must not surface as a claimable hit.
    claimed_q = await authed_client.get(
        "/staff/v1/unassigned-registrations/search", params={"q": "สมหญิง"}
    )
    assert claimed_q.status_code == 200
    assert claimed_q.json()["results"] == []

    # Open sibling still searchable; response lists only open members.
    open_q = await authed_client.get(
        "/staff/v1/unassigned-registrations/search", params={"q": "สมชาย"}
    )
    assert open_q.status_code == 200
    hits = open_q.json()["results"]
    assert len(hits) == 1
    assert hits[0]["id"] == doc.id
    assert [m["first_name"] for m in hits[0]["open_members"]] == ["สมชาย"]
    assert all(m["status"] == "open" for m in hits[0]["open_members"])


async def test_search_blank_query_returns_empty(authed_client: AsyncClient) -> None:
    await _seed_registration()
    response = await authed_client.get(
        "/staff/v1/unassigned-registrations/search", params={"q": "  "}
    )
    assert response.status_code == 200
    assert response.json()["results"] == []


async def test_search_mongo_unreachable_returns_online_required(
    authed_client: AsyncClient,
) -> None:
    mock_query = MagicMock()
    mock_query.sort.return_value.to_list = AsyncMock(side_effect=ConnectionError("mongo down"))
    with patch(
        "apiapp.modules.unassigned_registrations.use_case.UnassignedRegistration.find",
        return_value=mock_query,
    ):
        response = await authed_client.get(
            "/staff/v1/unassigned-registrations/search", params={"q": "สมชาย"}
        )
    assert response.status_code == 503
    detail = response.json()["errors"][0]
    assert detail["error"]["code"] == "ONLINE_REQUIRED"
