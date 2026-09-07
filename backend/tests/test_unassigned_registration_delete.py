"""CR-113 / #246 — system_admin DELETE Unassigned Registration (FastAPI seam)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedRegistration,
)

from apiapp.core.staff_session import (
    StaffSession,
    require_registration_staff,
    require_staff_session,
    require_system_admin,
)
from apiapp.utils.ulid import new_ulid


@pytest.fixture
def sa_session() -> StaffSession:
    return StaffSession(
        name="sys.admin",
        roles=["system_admin"],
        shelter_code=None,
        is_sa=True,
    )


@pytest.fixture
def registration_staff_session() -> StaffSession:
    return StaffSession(
        name="reg.staff",
        roles=["shelter:SH001", "SH001:registration_staff"],
        shelter_code="SH001",
        is_sa=False,
    )


@pytest.fixture
def shelter_manager_session() -> StaffSession:
    return StaffSession(
        name="mgr",
        roles=["shelter:SH001", "SH001:shelter_manager"],
        shelter_code="SH001",
        is_sa=False,
    )


@pytest.fixture
async def sa_client(client: AsyncClient, app, sa_session: StaffSession):
    app.dependency_overrides[require_system_admin] = lambda: sa_session
    yield client
    app.dependency_overrides.pop(require_system_admin, None)


async def _seed_registration() -> UnassignedRegistration:
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=1,
        reserved_household_id=f"household:{new_ulid()}",
        members=[
            UnassignedMember(
                reserved_evacuee_id=f"evacuee:{new_ulid()}",
                status="open",
                first_name="สมชาย",
                last_name="ใจดี",
                gender="male",
                phone="0812345678",
                person_id=PersonId(cardType="national_id", number="1234567890123"),
                country="THAILAND",
            )
        ],
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
        open_person_id_numbers=["1234567890123"],
        open_phones=["0812345678"],
    )
    await doc.insert()
    return doc


async def test_delete_requires_staff_session(client: AsyncClient) -> None:
    response = await client.delete("/staff/v1/unassigned-registrations/does-not-exist")
    assert response.status_code == 401
    body = response.json()
    assert body["errors"][0]["error"]["code"] == "UNAUTHENTICATED"


async def test_delete_rejects_bearer_external_secret(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Purge must not accept public-plane EXTERNAL_API_SECRET."""
    response = await client.delete(
        "/staff/v1/unassigned-registrations/does-not-exist",
        headers=auth_headers,
    )
    assert response.status_code == 401


@pytest.mark.parametrize(
    "session_fixture",
    ["registration_staff_session", "shelter_manager_session"],
)
async def test_delete_rejects_non_system_admin(
    client: AsyncClient,
    app,
    session_fixture: str,
    request: pytest.FixtureRequest,
) -> None:
    """Non–system_admin staff who can search/claim must still be rejected on purge."""
    session: StaffSession = request.getfixturevalue(session_fixture)
    doc = await _seed_registration()
    app.dependency_overrides[require_staff_session] = lambda: session
    try:
        response = await client.delete(f"/staff/v1/unassigned-registrations/{doc.id}")
    finally:
        app.dependency_overrides.pop(require_staff_session, None)

    assert response.status_code == 403
    detail = response.json()["errors"][0]
    assert detail["error"]["code"] == "FORBIDDEN"
    assert await UnassignedRegistration.get(doc.id) is not None


async def test_system_admin_hard_deletes_mongo_document(sa_client: AsyncClient) -> None:
    doc = await _seed_registration()
    doc_id = doc.id

    response = await sa_client.delete(f"/staff/v1/unassigned-registrations/{doc_id}")
    assert response.status_code == 204

    assert await UnassignedRegistration.get(doc_id) is None


async def test_purge_verifiable_without_claim(sa_client: AsyncClient, app) -> None:
    """Purge removes the queue doc; search no longer finds it (no claim required)."""
    doc = await _seed_registration()
    doc_id = doc.id

    delete_resp = await sa_client.delete(f"/staff/v1/unassigned-registrations/{doc_id}")
    assert delete_resp.status_code == 204
    assert await UnassignedRegistration.get(doc_id) is None

    staff = StaffSession(
        name="reg.staff",
        roles=["shelter:SH001", "SH001:registration_staff"],
        shelter_code="SH001",
        is_sa=False,
    )
    app.dependency_overrides[require_registration_staff] = lambda: staff
    try:
        search = await sa_client.get(
            "/staff/v1/unassigned-registrations/search", params={"q": "สมชาย"}
        )
    finally:
        app.dependency_overrides.pop(require_registration_staff, None)

    assert search.status_code == 200
    assert all(hit["id"] != doc_id for hit in search.json()["results"])


async def test_delete_missing_id_returns_404(sa_client: AsyncClient) -> None:
    response = await sa_client.delete("/staff/v1/unassigned-registrations/missing-ulid")
    assert response.status_code == 404
    detail = response.json()["errors"][0]
    assert detail["error"]["code"] == "NOT_FOUND"
