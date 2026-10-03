"""CR-140 addendum — staff pre-claim review + photo read (open-only, no write)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedPet,
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


async def _seed_registration_with_pet(*, member_status: str = "open", pet_status: str = "open"):
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=3,
        reserved_household_id=f"household:{new_ulid()}",
        members=[
            UnassignedMember(
                reserved_evacuee_id=f"evacuee:{new_ulid()}",
                status=member_status,
                first_name="สมชาย",
                last_name="ใจดี",
                gender="male",
                phone="0812345678",
                person_id=PersonId(cardType="national_id", number="1234567890123"),
                country="THAILAND",
            ),
            UnassignedMember(
                reserved_evacuee_id=f"evacuee:{new_ulid()}",
                status="claimed",
                first_name="สมหญิง",
                last_name="ใจดี",
                gender="female",
                phone="0898765432",
                country="THAILAND",
            ),
        ],
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="123/45",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            label="ครอบครัวใจดี",
            pets=[
                UnassignedPet(
                    pet_id=f"pet:{new_ulid()}",
                    status=pet_status,
                    species="dog",
                    count=1,
                    image_url="gfs:507f1f77bcf86cd799439011",
                ),
                UnassignedPet(
                    pet_id=f"pet:{new_ulid()}",
                    status="claimed",
                    species="cat",
                    count=1,
                ),
            ],
        ),
        status="open",
        registered_via="web",
        created_at=datetime.now(UTC),
        open_person_id_numbers=(["1234567890123"] if member_status == "open" else []),
        open_phones=(["0812345678"] if member_status == "open" else []),
    )
    await doc.insert()
    return doc


async def test_review_requires_staff_session(client: AsyncClient) -> None:
    response = await client.get(f"/staff/v1/unassigned-registrations/{new_ulid()}/review")
    assert response.status_code == 401


async def test_review_404_for_unknown_id(authed_client: AsyncClient) -> None:
    response = await authed_client.get(f"/staff/v1/unassigned-registrations/{new_ulid()}/review")
    assert response.status_code == 404
    assert response.json()["errors"][0]["error"]["code"] == "NOT_FOUND"


async def test_review_returns_only_open_members_and_pets(authed_client: AsyncClient) -> None:
    doc = await _seed_registration_with_pet()

    response = await authed_client.get(f"/staff/v1/unassigned-registrations/{doc.id}/review")
    assert response.status_code == 200
    body = response.json()

    assert body["id"] == doc.id
    assert body["reserved_household_id"] == doc.reserved_household_id
    assert body["label"] == "ครอบครัวใจดี"
    assert body["address_no"] == "123/45"

    assert len(body["open_members"]) == 1
    assert body["open_members"][0]["first_name"] == "สมชาย"
    assert body["open_members"][0]["status"] == "open"

    assert len(body["open_pets"]) == 1
    assert body["open_pets"][0]["species"] == "dog"
    assert body["open_pets"][0]["image_url"] == "gfs:507f1f77bcf86cd799439011"

    # Response has no `pets` key with claim status embedded (unlike SA detail's HouseholdOut).
    assert "pets" not in body


async def test_review_nothing_is_written(authed_client: AsyncClient) -> None:
    doc = await _seed_registration_with_pet()

    await authed_client.get(f"/staff/v1/unassigned-registrations/{doc.id}/review")

    reloaded = await UnassignedRegistration.get(doc.id)
    assert reloaded is not None
    assert reloaded.status == "open"
    assert reloaded.members[0].status == "open"


async def test_photo_requires_staff_session(client: AsyncClient) -> None:
    response = await client.get(
        "/staff/v1/unassigned-registrations/photos/507f1f77bcf86cd799439011"
    )
    assert response.status_code == 401


async def test_photo_404_when_not_referenced_by_any_open_row(
    authed_client: AsyncClient,
) -> None:
    response = await authed_client.get(
        "/staff/v1/unassigned-registrations/photos/507f1f77bcf86cd799439099"
    )
    assert response.status_code == 404


async def test_photo_404_for_malformed_id(authed_client: AsyncClient) -> None:
    response = await authed_client.get("/staff/v1/unassigned-registrations/photos/not-an-oid")
    assert response.status_code == 404


async def test_photo_streams_bytes_when_referenced_by_open_pet(
    authed_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from apiapp.infrastructure.gridfs import LoadedUnassignedPhoto

    await _seed_registration_with_pet()

    async def fake_load(photo_id: str) -> LoadedUnassignedPhoto | None:
        assert photo_id == "gfs:507f1f77bcf86cd799439011"
        return LoadedUnassignedPhoto(
            full_bytes=b"fake-image-bytes",
            thumb_bytes=None,
            content_type="image/webp",
            filename="face.webp",
            width=None,
            height=None,
            original_size=None,
            compressed_size=17,
            thumbnail_size=None,
        )

    import apiapp.modules.unassigned_registrations.router as router_module

    monkeypatch.setattr(router_module, "load_unassigned_photo", fake_load)

    response = await authed_client.get(
        "/staff/v1/unassigned-registrations/photos/507f1f77bcf86cd799439011"
    )
    assert response.status_code == 200
    assert response.content == b"fake-image-bytes"
    assert response.headers["content-type"] == "image/webp"


async def test_photo_found_when_referenced_by_open_member(
    authed_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from apiapp.infrastructure.gridfs import LoadedUnassignedPhoto

    doc = await _seed_registration_with_pet()
    doc.members[0].photo = "gfs:507f1f77bcf86cd799439022"
    await doc.save()

    async def fake_load(photo_id: str) -> LoadedUnassignedPhoto | None:
        return LoadedUnassignedPhoto(
            full_bytes=b"member-face",
            thumb_bytes=None,
            content_type="image/webp",
            filename="face.webp",
            width=None,
            height=None,
            original_size=None,
            compressed_size=11,
            thumbnail_size=None,
        )

    import apiapp.modules.unassigned_registrations.router as router_module

    monkeypatch.setattr(router_module, "load_unassigned_photo", fake_load)

    response = await authed_client.get(
        "/staff/v1/unassigned-registrations/photos/507f1f77bcf86cd799439022"
    )
    assert response.status_code == 200
    assert response.content == b"member-face"
