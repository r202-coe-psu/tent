"""CR-113 / #247 — claim open members → Couch Evacuee birth (partial + full)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_person import PublicPerson
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedRegistration,
)

from apiapp.core.staff_session import (
    StaffSession,
    require_registration_staff,
    require_shelter_scoped_staff,
)
from apiapp.modules.unassigned_registrations.couch_birth import (
    EVACUEE_SCHEMA_V,
    HOUSEHOLD_SCHEMA_V,
    CouchBirthError,
    InMemoryCouchBirth,
    get_couch_birth,
)
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
def other_shelter_session() -> StaffSession:
    return StaffSession(
        name="reg.other",
        roles=["shelter:SH002", "SH002:registration_staff"],
        shelter_code="SH002",
        is_sa=False,
    )


@pytest.fixture
def couch_birth() -> InMemoryCouchBirth:
    return InMemoryCouchBirth()


@pytest.fixture
async def authed_client(
    client: AsyncClient, app, staff_session: StaffSession, couch_birth: InMemoryCouchBirth
):
    # Claim uses require_registration_staff; post-claim search uses the wider
    # require_shelter_scoped_staff (#251). Override both so partial-claim tests
    # can assert the open member remains searchable without a real Couch cookie.
    app.dependency_overrides[require_registration_staff] = lambda: staff_session
    app.dependency_overrides[require_shelter_scoped_staff] = lambda: staff_session
    app.dependency_overrides[get_couch_birth] = lambda: couch_birth
    yield client
    app.dependency_overrides.pop(require_registration_staff, None)
    app.dependency_overrides.pop(require_shelter_scoped_staff, None)
    app.dependency_overrides.pop(get_couch_birth, None)


async def _seed_two_member_registration(
    *,
    first_a: str = "สมชาย",
    first_b: str = "สมหญิง",
) -> UnassignedRegistration:
    members = [
        UnassignedMember(
            reserved_evacuee_id=f"evacuee:{new_ulid()}",
            status="open",
            first_name=first_a,
            last_name="ใจดี",
            gender="male",
            phone="0812345678",
            person_id=PersonId(cardType="national_id", number="1234567890123"),
            country="THAILAND",
            vulnerable_groups=["elderly"],
            special_needs=["wheelchair"],
        ),
        UnassignedMember(
            reserved_evacuee_id=f"evacuee:{new_ulid()}",
            status="open",
            first_name=first_b,
            last_name="ใจดี",
            gender="female",
            phone="0898765432",
            person_id=PersonId(cardType="national_id", number="9876543210987"),
            country="THAILAND",
        ),
    ]
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=1,
        reserved_household_id=f"household:{new_ulid()}",
        members=members,
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="123/45",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            pets=[],
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


async def test_claim_requires_staff_session(client: AsyncClient) -> None:
    response = await client.post(
        f"/staff/v1/unassigned-registrations/{new_ulid()}/claim",
        json={"member_ids": [f"evacuee:{new_ulid()}"]},
    )
    assert response.status_code == 401


async def test_claim_rejects_bearer_external_secret(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        f"/staff/v1/unassigned-registrations/{new_ulid()}/claim",
        headers=auth_headers,
        json={"member_ids": [f"evacuee:{new_ulid()}"]},
    )
    assert response.status_code == 401


async def test_partial_claim_births_couch_for_ticked_only_and_leaves_open_searchable(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    doc = await _seed_two_member_registration()
    claim_id = doc.members[0].reserved_evacuee_id
    leave_id = doc.members[1].reserved_evacuee_id

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [claim_id]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["deleted"] is False
    assert body["shelter_code"] == "SH001"
    assert body["household_id"] == doc.reserved_household_id
    assert claim_id in body["evacuee_ids"]
    assert leave_id not in body["evacuee_ids"]
    assert len(body["remaining_open"]) == 1
    assert body["remaining_open"][0]["reserved_evacuee_id"] == leave_id

    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    by_id = {m.reserved_evacuee_id: m for m in stored.members}
    assert by_id[claim_id].status == "claimed"
    assert by_id[claim_id].claimed_shelter_code == "SH001"
    assert by_id[leave_id].status == "open"
    assert "1234567890123" not in stored.open_person_id_numbers
    assert "9876543210987" in stored.open_person_id_numbers

    # Supporting Couch-birth assertions (injected birth port — no public_persons).
    born = couch_birth.docs_for("SH001")
    assert doc.reserved_household_id in born
    assert claim_id in born
    assert leave_id not in born
    household = born[doc.reserved_household_id]
    assert household["type"] == "household"
    assert household["_id"] == doc.reserved_household_id
    assert household["schema_v"] == HOUSEHOLD_SCHEMA_V
    assert household["status"] == "pre_registered"
    assert household["shelter_code"] == "SH001"
    evacuee = born[claim_id]
    assert evacuee["type"] == "evacuee"
    assert evacuee["_id"] == claim_id
    assert evacuee["schema_v"] == EVACUEE_SCHEMA_V
    assert evacuee["current_stay"]["status"] == "pre_registered"
    assert evacuee["household_id"] == doc.reserved_household_id
    assert evacuee["first_name"] == "สมชาย"
    assert evacuee["shelter_code"] == "SH001"
    assert await PublicPerson.get(claim_id) is None

    # Unticked member remains searchable on the central queue.
    search = await authed_client.get(
        "/staff/v1/unassigned-registrations/search", params={"q": "สมหญิง"}
    )
    assert search.status_code == 200
    hits = search.json()["results"]
    assert len(hits) == 1
    assert hits[0]["id"] == doc.id
    assert [m["reserved_evacuee_id"] for m in hits[0]["open_members"]] == [leave_id]


async def test_full_claim_hard_deletes_mongo_document(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    doc = await _seed_two_member_registration()
    ids = [m.reserved_evacuee_id for m in doc.members]

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": ids},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["deleted"] is True
    assert body["remaining_open"] == []
    assert set(body["evacuee_ids"]) == set(ids)

    assert await UnassignedRegistration.get(doc.id) is None
    born = couch_birth.docs_for("SH001")
    assert doc.reserved_household_id in born
    assert all(eid in born for eid in ids)
    assert await PublicPerson.count() == 0


async def test_full_claim_returns_success_when_mongo_delete_fails(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Best-effort delete: Couch birth wins; orphan Mongo doc stays trackable (CR-113)."""
    doc = await _seed_two_member_registration()
    ids = [m.reserved_evacuee_id for m in doc.members]
    registration_id = doc.id

    async def boom_delete(self: UnassignedRegistration) -> None:
        raise ConnectionError("mongo delete unavailable")

    monkeypatch.setattr(UnassignedRegistration, "delete", boom_delete)

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{registration_id}/claim",
        json={"member_ids": ids},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["deleted"] is False
    assert body["id"] == registration_id
    assert body["remaining_open"] == []
    assert set(body["evacuee_ids"]) == set(ids)

    born = couch_birth.docs_for("SH001")
    assert doc.reserved_household_id in born
    assert all(eid in born for eid in ids)
    # Orphan remains in Mongo (all members claimed) so desk/admin can track it.
    stored = await UnassignedRegistration.get(registration_id)
    assert stored is not None
    assert stored.status == "claimed"
    assert all(m.status == "claimed" for m in stored.members)


async def test_already_claimed_member_cannot_be_claimed_by_another_shelter(
    client: AsyncClient,
    app,
    staff_session: StaffSession,
    other_shelter_session: StaffSession,
    couch_birth: InMemoryCouchBirth,
) -> None:
    doc = await _seed_two_member_registration()
    claim_id = doc.members[0].reserved_evacuee_id

    app.dependency_overrides[require_registration_staff] = lambda: staff_session
    app.dependency_overrides[get_couch_birth] = lambda: couch_birth
    first = await client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [claim_id]},
    )
    assert first.status_code == 200

    app.dependency_overrides[require_registration_staff] = lambda: other_shelter_session
    second = await client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [claim_id]},
    )
    assert second.status_code == 409
    detail = second.json()
    assert detail["errors"][0]["error"]["code"] == "ALREADY_CLAIMED"

    # Other shelter must not birth a duplicate Couch doc for the claimed member.
    assert claim_id not in couch_birth.docs_for("SH002")

    app.dependency_overrides.pop(require_registration_staff, None)
    app.dependency_overrides.pop(get_couch_birth, None)


async def test_claim_reuses_household_on_second_partial_at_same_shelter(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    doc = await _seed_two_member_registration()
    first_id = doc.members[0].reserved_evacuee_id
    second_id = doc.members[1].reserved_evacuee_id

    r1 = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [first_id]},
    )
    assert r1.status_code == 200
    household_writes = couch_birth.write_counts["SH001"].get(doc.reserved_household_id, 0)
    assert household_writes == 1

    r2 = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [second_id]},
    )
    assert r2.status_code == 200
    assert r2.json()["deleted"] is True
    # Household was not rewritten on the second claim.
    assert couch_birth.write_counts["SH001"][doc.reserved_household_id] == 1
    assert second_id in couch_birth.docs_for("SH001")


async def test_claim_rolls_back_mongo_when_couch_birth_fails(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    doc = await _seed_two_member_registration()
    claim_id = doc.members[0].reserved_evacuee_id
    couch_birth.fail_next = CouchBirthError("simulated couch outage")

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [claim_id]},
    )
    assert response.status_code == 503
    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    by_id = {m.reserved_evacuee_id: m for m in stored.members}
    assert by_id[claim_id].status == "open"
    assert claim_id not in couch_birth.docs_for("SH001")


async def test_claim_not_found(authed_client: AsyncClient) -> None:
    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{new_ulid()}/claim",
        json={"member_ids": [f"evacuee:{new_ulid()}"]},
    )
    assert response.status_code == 404


async def test_claim_rejects_empty_member_ids(authed_client: AsyncClient) -> None:
    doc = await _seed_two_member_registration()
    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": []},
    )
    assert response.status_code == 422


async def test_claim_copies_nickname_religion_and_emergency_contact(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    """#255 — claim copies expanded public fields into Couch Evacuee."""
    from tent_model.unassigned_registration import EmergencyContact

    members = [
        UnassignedMember(
            reserved_evacuee_id=f"evacuee:{new_ulid()}",
            status="open",
            first_name="สมชาย",
            last_name="ใจดี",
            gender="male",
            phone="0812345678",
            person_id=PersonId(cardType="national_id", number="1234567890123"),
            country="THAILAND",
            nickname="ชาย",
            religion="buddhist",
            emergency_contact=EmergencyContact(
                name="สมหญิง", phone="0899999999", relation="คู่สมรส"
            ),
        )
    ]
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=2,
        reserved_household_id=f"household:{new_ulid()}",
        members=members,
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="123/45",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            pets=[],
        ),
        status="open",
        registered_via="web",
        created_at=datetime.now(UTC),
        open_person_id_numbers=["1234567890123"],
        open_phones=["0812345678"],
    )
    await doc.insert()

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [members[0].reserved_evacuee_id]},
    )
    assert response.status_code == 200
    born = couch_birth.docs_for("SH001")
    evacuee = born[members[0].reserved_evacuee_id]
    assert evacuee["nickname"] == "ชาย"
    assert evacuee["religion"] == "buddhist"
    assert evacuee["emergency_contact"] == {
        "name": "สมหญิง",
        "phone": "0899999999",
        "relation": "คู่สมรส",
    }


async def test_claim_resolves_pet_gridfs_image_url(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """#255 pet photo — claim births Couch image + sets household.pets[].image_url."""
    from tent_model.unassigned_registration import UnassignedPet

    from apiapp.infrastructure.gridfs import LoadedUnassignedPhoto
    from apiapp.modules.unassigned_registrations import use_case as claim_use_case

    async def fake_load(photo_id: str) -> LoadedUnassignedPhoto | None:
        if photo_id != "gfs:507f1f77bcf86cd799439012":
            return None
        return LoadedUnassignedPhoto(
            full_bytes=b"pet-full",
            thumb_bytes=b"pet-thumb",
            content_type="image/webp",
            filename="pet.webp",
            width=100,
            height=80,
            original_size=200,
            compressed_size=50,
            thumbnail_size=20,
        )

    monkeypatch.setattr(claim_use_case, "load_unassigned_photo", fake_load)

    members = [
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
    ]
    household_id = f"household:{new_ulid()}"
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=2,
        reserved_household_id=household_id,
        members=members,
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="123/45",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            pets=[
                UnassignedPet(
                    species="dog",
                    count=1,
                    has_cage=True,
                    image_url="gfs:507f1f77bcf86cd799439012",
                )
            ],
        ),
        status="open",
        registered_via="web",
        created_at=datetime.now(UTC),
        open_person_id_numbers=["1234567890123"],
        open_phones=["0812345678"],
    )
    await doc.insert()

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [members[0].reserved_evacuee_id]},
    )
    assert response.status_code == 200
    born = couch_birth.docs_for("SH001")
    household = born[household_id]
    assert len(household["pets"]) == 1
    pet_image = household["pets"][0]["image_url"]
    assert pet_image.startswith("image:")
    assert pet_image in born
    atts = couch_birth.attachments_for("SH001")
    assert atts[pet_image]["full"] == b"pet-full"
