"""Staff list/search must emit created_at as UTC with Z after Mongo round-trip."""

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
    require_shelter_scoped_staff,
    require_system_admin,
)
from apiapp.utils.ulid import new_ulid

# Fixed instant: 10:29 UTC == 17:29 Asia/Bangkok. Naive isoformat without Z
# would display as 10:29 in a Thai browser.
_FIXED_UTC = datetime(2026, 10, 9, 10, 29, 38, 166000, tzinfo=UTC)


@pytest.fixture
def sa_session() -> StaffSession:
    return StaffSession(
        name="sys.admin",
        roles=["system_admin"],
        shelter_code=None,
        is_sa=True,
    )


@pytest.fixture
def staff_session() -> StaffSession:
    return StaffSession(
        name="reg.staff",
        roles=["shelter:SH001", "SH001:registration_staff"],
        shelter_code="SH001",
        is_sa=False,
    )


@pytest.fixture
async def sa_client(client: AsyncClient, app, sa_session: StaffSession):
    app.dependency_overrides[require_system_admin] = lambda: sa_session
    yield client
    app.dependency_overrides.pop(require_system_admin, None)


@pytest.fixture
async def authed_client(client: AsyncClient, app, staff_session: StaffSession):
    app.dependency_overrides[require_shelter_scoped_staff] = lambda: staff_session
    yield client
    app.dependency_overrides.pop(require_shelter_scoped_staff, None)


async def _seed() -> UnassignedRegistration:
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=3,
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
        created_at=_FIXED_UTC,
        open_person_id_numbers=["1234567890123"],
        open_phones=["0812345678"],
    )
    await doc.insert()
    return doc


def _assert_utc_z(value: str) -> None:
    assert value.endswith("Z"), f"expected UTC Z suffix, got {value!r}"
    assert "+" not in value
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed == _FIXED_UTC


async def test_staff_list_created_at_is_utc_z_after_mongo_roundtrip(
    sa_client: AsyncClient,
) -> None:
    doc = await _seed()
    # Re-read proves Beanie sees naive UTC — the bug path for system overview.
    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    assert stored.created_at.tzinfo is None

    response = await sa_client.get("/staff/v1/unassigned-registrations")
    assert response.status_code == 200
    items = response.json()["items"]
    hit = next(item for item in items if item["id"] == doc.id)
    _assert_utc_z(hit["created_at"])


async def test_staff_search_created_at_is_utc_z_after_mongo_roundtrip(
    authed_client: AsyncClient,
) -> None:
    await _seed()

    response = await authed_client.get(
        "/staff/v1/unassigned-registrations/search",
        params={"q": "สมชาย"},
    )
    assert response.status_code == 200
    hits = response.json()["results"]
    assert len(hits) == 1
    _assert_utc_z(hits[0]["created_at"])


async def test_staff_detail_created_at_is_utc_z_after_mongo_roundtrip(
    sa_client: AsyncClient,
) -> None:
    doc = await _seed()

    response = await sa_client.get(f"/staff/v1/unassigned-registrations/{doc.id}")
    assert response.status_code == 200
    _assert_utc_z(response.json()["created_at"])
