"""CR-113 / #247 — claim open members → Couch Evacuee birth (partial + full)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_person import PublicPerson
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedPet,
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
def sa_session() -> StaffSession:
    return StaffSession(
        name="admin.sa",
        roles=["system_admin"],
        shelter_code=None,
        is_sa=True,
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


async def test_claim_births_null_and_legacy_other_gender_unchanged(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    """decision sync 2026-10-09: null stays null, legacy 'other' is preserved on claim."""
    doc = await _seed_two_member_registration()
    doc.members[0].gender = None
    doc.members[1].gender = "other"
    await doc.save()
    ids = [m.reserved_evacuee_id for m in doc.members]

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": ids},
    )
    assert response.status_code == 200

    born = couch_birth.docs_for("SH001")
    assert "gender" in born[ids[0]]
    assert born[ids[0]]["gender"] is None
    assert born[ids[1]]["gender"] == "other"


async def test_full_claim_retains_mongo_document_as_closed(
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
    assert body["deleted"] is False
    assert body["id"] == doc.id
    assert body["remaining_open"] == []
    assert set(body["evacuee_ids"]) == set(ids)

    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    assert stored.status == "closed"
    assert all(m.status == "claimed" for m in stored.members)

    born = couch_birth.docs_for("SH001")
    assert doc.reserved_household_id in born
    assert all(eid in born for eid in ids)
    assert await PublicPerson.count() == 0


async def test_full_claim_does_not_attempt_mongo_delete(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Persistent family: full claim must not hard-delete the Mongo document."""
    doc = await _seed_two_member_registration()
    ids = [m.reserved_evacuee_id for m in doc.members]
    registration_id = doc.id
    delete_calls = 0

    async def boom_delete(self: UnassignedRegistration) -> None:
        nonlocal delete_calls
        delete_calls += 1
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
    assert delete_calls == 0

    born = couch_birth.docs_for("SH001")
    assert doc.reserved_household_id in born
    assert all(eid in born for eid in ids)
    stored = await UnassignedRegistration.get(registration_id)
    assert stored is not None
    assert stored.status == "closed"
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


async def test_sa_claim_without_shelter_code_is_rejected(
    client: AsyncClient,
    app,
    sa_session: StaffSession,
    couch_birth: InMemoryCouchBirth,
) -> None:
    doc = await _seed_two_member_registration()
    claim_id = doc.members[0].reserved_evacuee_id

    app.dependency_overrides[require_registration_staff] = lambda: sa_session
    app.dependency_overrides[get_couch_birth] = lambda: couch_birth
    try:
        response = await client.post(
            f"/staff/v1/unassigned-registrations/{doc.id}/claim",
            json={"member_ids": [claim_id]},
        )
        assert response.status_code == 422
        assert response.json()["errors"][0]["error"]["code"] == "SHELTER_REQUIRED"
    finally:
        app.dependency_overrides.pop(require_registration_staff, None)
        app.dependency_overrides.pop(get_couch_birth, None)


async def test_sa_claim_with_shelter_code_succeeds(
    client: AsyncClient,
    app,
    sa_session: StaffSession,
    couch_birth: InMemoryCouchBirth,
) -> None:
    doc = await _seed_two_member_registration()
    claim_id = doc.members[0].reserved_evacuee_id

    app.dependency_overrides[require_registration_staff] = lambda: sa_session
    app.dependency_overrides[get_couch_birth] = lambda: couch_birth
    try:
        response = await client.post(
            f"/staff/v1/unassigned-registrations/{doc.id}/claim",
            json={"member_ids": [claim_id], "shelter_code": "SH001"},
        )
        assert response.status_code == 200
        assert response.json()["shelter_code"] == "SH001"
    finally:
        app.dependency_overrides.pop(require_registration_staff, None)
        app.dependency_overrides.pop(get_couch_birth, None)


async def test_claim_rejects_explicit_shelter_code_mismatch(
    client: AsyncClient,
    app,
    staff_session: StaffSession,
    couch_birth: InMemoryCouchBirth,
) -> None:
    """Shelter-scoped staff (SH001) explicitly naming a different shelter_code → 403.

    Distinct from `test_already_claimed_member_cannot_be_claimed_by_another_shelter`,
    which never sends `shelter_code` at all and asserts 409 ALREADY_CLAIMED — this
    exercises the explicit-mismatch branch of `_resolve_claim_shelter` directly.
    """
    doc = await _seed_two_member_registration()
    claim_id = doc.members[0].reserved_evacuee_id

    app.dependency_overrides[require_registration_staff] = lambda: staff_session
    app.dependency_overrides[get_couch_birth] = lambda: couch_birth
    try:
        response = await client.post(
            f"/staff/v1/unassigned-registrations/{doc.id}/claim",
            json={"member_ids": [claim_id], "shelter_code": "SH002"},
        )
        assert response.status_code == 403
        assert response.json()["errors"][0]["error"]["code"] == "FORBIDDEN"
    finally:
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
    assert r2.json()["deleted"] is False
    assert r2.json()["id"] == doc.id
    # Household was not rewritten on the second claim (members only).
    assert couch_birth.write_counts["SH001"][doc.reserved_household_id] == 1
    assert second_id in couch_birth.docs_for("SH001")

    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    assert stored.status == "closed"


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


async def test_concurrent_claims_on_same_member_only_one_wins(
    authed_client: AsyncClient, couch_birth: InMemoryCouchBirth
) -> None:
    """Two requests racing on the same member_id — `_atomic_mark_claimed`'s single
    `update_one` with array_filters must serialize them: exactly one 200, one 409,
    and only one Couch birth. Test DB is a real Mongo (see conftest.py), so this
    exercises genuine concurrent dispatch, not just sequential awaits."""
    doc = await _seed_two_member_registration()
    claim_id = doc.members[0].reserved_evacuee_id

    responses = await asyncio.gather(
        authed_client.post(
            f"/staff/v1/unassigned-registrations/{doc.id}/claim",
            json={"member_ids": [claim_id]},
        ),
        authed_client.post(
            f"/staff/v1/unassigned-registrations/{doc.id}/claim",
            json={"member_ids": [claim_id]},
        ),
    )
    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200, 409]

    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    by_id = {m.reserved_evacuee_id: m for m in stored.members}
    assert by_id[claim_id].status == "claimed"

    born = couch_birth.docs_for("SH001")
    assert sum(1 for d in born.values() if d["type"] == "evacuee") == 1


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


async def test_claim_dedupes_repeated_member_id_in_same_request(
    authed_client: AsyncClient, couch_birth: InMemoryCouchBirth
) -> None:
    """`_dedupe_ids` (schemas.py) must collapse a repeated id — claim once, not twice."""
    doc = await _seed_two_member_registration()
    claim_id = doc.members[0].reserved_evacuee_id

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [claim_id, claim_id]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["evacuee_ids"] == [claim_id]
    assert len(body["claimed"]) == 1

    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    assert [m.status for m in stored.members if m.reserved_evacuee_id == claim_id] == ["claimed"]
    # Exactly one household + one evacuee doc born — not a third from a duplicate birth.
    born = couch_birth.docs_for("SH001")
    assert len(born) == 2
    assert sum(1 for d in born.values() if d["type"] == "evacuee") == 1


async def test_claim_rejects_a_cancelled_member(authed_client: AsyncClient) -> None:
    """`MemberStatus` includes "cancelled" but no write path sets it yet — lock in that the
    generic MEMBER_NOT_OPEN check still rejects it if a doc is ever constructed with one
    (e.g. a future admin/cancel path), same as an already-claimed member."""
    doc = await _seed_two_member_registration()
    cancelled_id = doc.members[0].reserved_evacuee_id
    doc.members[0].status = "cancelled"
    await doc.save()

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [cancelled_id]},
    )
    assert response.status_code == 409
    detail = response.json()
    assert detail["errors"][0]["error"]["code"] == "MEMBER_NOT_OPEN"


async def test_claim_pets_only_on_registration_with_zero_members_fails(
    authed_client: AsyncClient,
) -> None:
    """Pets-only claim needs at least one household member on the doc for the first
    Couch household birth — a doc with literally no members (not just none open)
    must 422, not pick a bogus head."""
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=1,
        reserved_household_id=f"household:{new_ulid()}",
        members=[],
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="123/45",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            pets=[UnassignedPet(pet_id=f"pet:{new_ulid()}", status="open", species="dog", count=1)],
            label="ครอบครัวไร้คน",
        ),
        status="open",
        registered_via="web",
        created_at=datetime.now(UTC),
        open_person_id_numbers=[],
        open_phones=[],
    )
    await doc.insert()
    pet_id = doc.household.pets[0].pet_id

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"pet_ids": [pet_id]},
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["error"]["code"] == "NO_HOUSEHOLD_HEAD"


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
            emergency_contact=EmergencyContact(name="สมหญิง", phone="0899999999", relation="คู่สมรส"),
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
                    pet_id=f"pet:{new_ulid()}",
                    status="open",
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

    pet_id = doc.household.pets[0].pet_id
    assert pet_id is not None

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={
            "member_ids": [members[0].reserved_evacuee_id],
            "pet_ids": [pet_id],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["claimed_pets"][0]["pet_id"] == pet_id
    born = couch_birth.docs_for("SH001")
    household = born[household_id]
    assert len(household["pets"]) == 1
    pet_image = household["pets"][0]["image_url"]
    assert pet_image.startswith("image:")
    assert pet_image in born
    atts = couch_birth.attachments_for("SH001")
    assert atts[pet_image]["full"] == b"pet-full"


async def test_claim_proceeds_without_photo_when_member_gridfs_row_is_missing(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A member's `photo` ref pointing at a GridFS row that's gone must not fail the
    whole claim — birth proceeds without a photo (mirrors the pet-photo-missing path,
    but for the MEMBER photo specifically, which test_claim_resolves_pet_gridfs_image_url
    does not cover)."""
    from apiapp.infrastructure.gridfs import LoadedUnassignedPhoto
    from apiapp.modules.unassigned_registrations import use_case as claim_use_case

    async def fake_load(photo_id: str) -> LoadedUnassignedPhoto | None:
        return None

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
            photo="gfs:507f1f77bcf86cd799439099",
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
    claim_id = members[0].reserved_evacuee_id

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [claim_id]},
    )
    assert response.status_code == 200

    born = couch_birth.docs_for("SH001")
    evacuee_doc = born[claim_id]
    assert "photo" not in evacuee_doc


async def test_join_after_full_claim_reopens_closed_document(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    """Late join appends to the same Mongo family doc after it was closed."""
    doc = await _seed_two_member_registration()
    ids = [m.reserved_evacuee_id for m in doc.members]
    claim = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": ids},
    )
    assert claim.status_code == 200
    closed = await UnassignedRegistration.get(doc.id)
    assert closed is not None
    assert closed.status == "closed"

    join = await client.post(
        "/public/v1/unassigned-registrations",
        headers=auth_headers,
        json={
            "join_registration_id": doc.id,
            "registered_via": "web",
            "members": [
                {
                    "first_name": "สมปอง",
                    "last_name": "ใจดี",
                    "gender": "male",
                    "phone": "0888888888",
                    "person_id": {"cardType": "national_id", "number": "1111111111111"},
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
                "pets": [{"species": "cat", "count": 1}],
            },
        },
    )
    assert join.status_code == 201
    body = join.json()
    assert body["id"] == doc.id
    assert body["status"] == "open"
    assert len(body["members"]) == 3

    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    assert stored.status == "open"
    assert stored.reserved_household_id == doc.reserved_household_id
    assert sum(1 for m in stored.members if m.status == "open") == 1
    assert len(stored.household.pets) == 1
    assert stored.household.pets[0].status == "open"
    assert stored.household.pets[0].pet_id


async def test_claim_people_and_pets_together(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    from tent_model.unassigned_registration import UnassignedPet

    pet_id = f"pet:{new_ulid()}"
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
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=3,
        reserved_household_id=f"household:{new_ulid()}",
        members=members,
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="1",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            pets=[
                UnassignedPet(
                    pet_id=pet_id,
                    status="open",
                    species="dog",
                    count=1,
                    has_cage=False,
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
        json={
            "member_ids": [members[0].reserved_evacuee_id],
            "pet_ids": [pet_id],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["deleted"] is False
    assert body["claimed_pets"][0]["pet_id"] == pet_id
    born = couch_birth.docs_for("SH001")
    assert len(born[doc.reserved_household_id]["pets"]) == 1
    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    assert stored.status == "closed"
    assert stored.household.pets[0].status == "claimed"
    assert stored.household.pets[0].claimed_shelter_code == "SH001"


async def test_claim_pets_only_appends_to_existing_household(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    from tent_model.unassigned_registration import UnassignedPet

    pet_id = f"pet:{new_ulid()}"
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
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=3,
        reserved_household_id=f"household:{new_ulid()}",
        members=members,
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="1",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            pets=[
                UnassignedPet(
                    pet_id=pet_id,
                    status="open",
                    species="cat",
                    count=1,
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

    first = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [members[0].reserved_evacuee_id]},
    )
    assert first.status_code == 200
    assert first.json()["remaining_open_pets"][0]["pet_id"] == pet_id
    hh = couch_birth.docs_for("SH001")[doc.reserved_household_id]
    assert hh["pets"] == []

    second = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"pet_ids": [pet_id]},
    )
    assert second.status_code == 200
    assert second.json()["evacuee_ids"] == []
    assert second.json()["claimed_pets"][0]["pet_id"] == pet_id
    hh2 = couch_birth.docs_for("SH001")[doc.reserved_household_id]
    assert len(hh2["pets"]) == 1
    assert hh2["pets"][0]["species"] == "cat"
    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    assert stored.status == "closed"


async def test_legacy_pet_without_pet_id_defaults_open_and_is_claimable(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    from tent_model.unassigned_registration import UnassignedPet

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
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=2,
        reserved_household_id=f"household:{new_ulid()}",
        members=members,
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="1",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            pets=[UnassignedPet(species="dog", count=2)],  # legacy count>1, no pet_id
        ),
        status="open",
        registered_via="web",
        created_at=datetime.now(UTC),
        open_person_id_numbers=["1234567890123"],
        open_phones=["0812345678"],
    )
    await doc.insert()

    # Claim people first so we can discover minted pet_id via remaining_open_pets /
    # re-fetch after ensure on claim of people alone leaves pet open.
    people = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [members[0].reserved_evacuee_id]},
    )
    assert people.status_code == 200
    remaining_pets = people.json()["remaining_open_pets"]
    assert len(remaining_pets) == 1
    minted = remaining_pets[0]["pet_id"]
    assert minted.startswith("pet:")
    assert remaining_pets[0]["count"] == 2

    pets_claim = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"pet_ids": [minted]},
    )
    assert pets_claim.status_code == 200
    hh = couch_birth.docs_for("SH001")[doc.reserved_household_id]
    assert hh["pets"][0]["count"] == 2


async def test_review_and_claim_carry_cr148_fields(
    authed_client: AsyncClient,
    couch_birth: InMemoryCouchBirth,
) -> None:
    """CR-148 FR-18 — review exposes new fields; claim copies them into Couch."""
    member = UnassignedMember(
        reserved_evacuee_id=f"evacuee:{new_ulid()}",
        status="open",
        first_name="สมชาย",
        last_name="ใจดี",
        gender="male",
        phone="0812345678",
        person_id=PersonId(cardType="national_id", number="1234567890123"),
        country="THAILAND",
        religion="other",
        religion_other="ซิกข์",
        vulnerable_groups=["disability_other"],
        disability_other_detail="ไม่ได้ยินข้างซ้าย",
    )
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=3,
        reserved_household_id=f"household:{new_ulid()}",
        members=[member],
        household=UnassignedHousehold(
            housing_type="apartment_dorm",
            dorm_name="หอสุขใจ",
            dorm_building="B",
            dorm_floor="3",
            dorm_room="305",
            address_no="305 หอสุขใจ อาคาร B ชั้น 3",
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

    review = await authed_client.get(f"/staff/v1/unassigned-registrations/{doc.id}/review")
    assert review.status_code == 200
    review_body = review.json()
    assert review_body["dorm_name"] == "หอสุขใจ"
    assert review_body["dorm_room"] == "305"
    assert review_body["open_members"][0]["religion_other"] == "ซิกข์"
    assert review_body["open_members"][0]["disability_other_detail"] == "ไม่ได้ยินข้างซ้าย"

    response = await authed_client.post(
        f"/staff/v1/unassigned-registrations/{doc.id}/claim",
        json={"member_ids": [member.reserved_evacuee_id]},
    )
    assert response.status_code == 200
    born = couch_birth.docs_for("SH001")
    evacuee = born[member.reserved_evacuee_id]
    assert evacuee["religion"] == "other"
    assert evacuee["religion_other"] == "ซิกข์"
    assert evacuee["disability_other_detail"] == "ไม่ได้ยินข้างซ้าย"
    household = born[doc.reserved_household_id]
    assert household["dorm_name"] == "หอสุขใจ"
    assert household["dorm_building"] == "B"
    assert household["dorm_floor"] == "3"
    assert household["dorm_room"] == "305"
