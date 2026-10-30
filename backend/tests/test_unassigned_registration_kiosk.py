"""Kiosk lookup of an Unassigned Registration family (service secret, no PII)."""

from __future__ import annotations

import base64
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


_PREPARE_URL = "/public/v1/unassigned-registrations/{registration_id}/kiosk-claim/prepare"


async def _prepare(
    client: AsyncClient,
    headers: dict[str, str],
    registration_id: str,
    **body: object,
):
    payload = {"shelter_code": "SH001", "device_id": "kiosk-7", **body}
    return await client.post(
        _PREPARE_URL.format(registration_id=registration_id), json=payload, headers=headers
    )


async def _lookup_members(
    client: AsyncClient, headers: dict[str, str], registration_id: str
) -> dict[str, tuple[str, str | None]]:
    response = await client.post(_URL, json={"registration_id": registration_id}, headers=headers)
    assert response.status_code == 200
    return {
        m["reserved_evacuee_id"]: (m["status"], m["claimed_shelter_code"])
        for m in response.json()["members"]
    }


async def test_kiosk_prepare_returns_couch_docs_and_claims_only_the_selected_member(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    selected, other_open, _ = (m.reserved_evacuee_id for m in doc.members)

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected])

    assert response.status_code == 200
    body = response.json()
    assert body["registration_id"] == doc.id
    assert body["shelter_code"] == "SH001"
    assert body["household"]["_id"] == doc.reserved_household_id
    assert [e["_id"] for e in body["evacuees"]] == [selected]
    evacuee = body["evacuees"][0]
    assert evacuee["shelter_code"] == "SH001"
    assert evacuee["household_id"] == doc.reserved_household_id
    assert evacuee["current_stay"]["status"] == "pre_registered"
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[selected] == ("claimed", "SH001")
    assert members[other_open] == ("open", None)


async def test_kiosk_prepare_stamps_the_kiosk_device_as_actor(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected])

    assert response.status_code == 200
    assert response.json()["evacuees"][0]["created_by"] == "kiosk:kiosk-7"


async def test_kiosk_prepare_returns_member_photo_as_couch_image_with_bytes(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from apiapp.infrastructure.gridfs import LoadedUnassignedPhoto
    from apiapp.modules.unassigned_registrations import use_case as use_case_module

    async def fake_load(photo_id: str) -> LoadedUnassignedPhoto | None:
        if photo_id != "gfs:507f1f77bcf86cd799439011":
            return None
        return LoadedUnassignedPhoto(
            full_bytes=b"face-full",
            thumb_bytes=b"face-thumb",
            content_type="image/webp",
            filename="face.webp",
            width=640,
            height=480,
            original_size=2000,
            compressed_size=900,
            thumbnail_size=300,
        )

    monkeypatch.setattr(use_case_module, "load_unassigned_photo", fake_load)
    doc = await _seed_family()
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected])

    assert response.status_code == 200
    body = response.json()
    [image] = body["images"]
    assert image["doc"]["_id"].startswith("image:")
    assert image["content_type"] == "image/webp"
    assert base64.b64decode(image["full_b64"]) == b"face-full"
    assert base64.b64decode(image["thumb_b64"]) == b"face-thumb"
    assert body["evacuees"][0]["photo"] == image["doc"]["_id"]


async def test_kiosk_prepare_never_claims_pets(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    doc.household.pets = [
        UnassignedPet(pet_id=f"pet:{new_ulid()}", status="open", species="dog", count=1)
    ]
    await doc.save()
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected])

    assert response.status_code == 200
    assert response.json()["household"]["pets"] == []
    reloaded = await UnassignedRegistration.get(doc.id)
    assert reloaded is not None
    assert [p.effective_status() for p in reloaded.household.pets or []] == ["open"]


_PET_PHOTO_REF = "gfs:507f1f77bcf86cd799439012"


async def _seed_family_with_pets(*, legacy_pet: bool = False) -> UnassignedRegistration:
    """`_seed_family` plus an open dog (with photo), an open cat and a cancelled other."""
    doc = await _seed_family()
    doc.household.pets = [
        UnassignedPet(
            pet_id=f"pet:{new_ulid()}",
            status="open",
            species="dog",
            count=1,
            has_cage=True,
            image_url=_PET_PHOTO_REF,
        ),
        UnassignedPet(
            pet_id=None if legacy_pet else f"pet:{new_ulid()}",
            status="open",
            species="cat",
            count=1,
        ),
        UnassignedPet(pet_id=f"pet:{new_ulid()}", status="cancelled", species="other", count=1),
    ]
    await doc.save()
    return doc


async def _stored_pets(registration_id: str) -> list[UnassignedPet]:
    reloaded = await UnassignedRegistration.get(registration_id)
    assert reloaded is not None
    return list(reloaded.household.pets or [])


async def _stored_status(registration_id: str) -> str:
    reloaded = await UnassignedRegistration.get(registration_id)
    assert reloaded is not None
    return reloaded.status


async def test_kiosk_prepare_with_claim_pets_claims_all_open_pets_and_returns_them_with_photo(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from apiapp.infrastructure.gridfs import LoadedUnassignedPhoto
    from apiapp.modules.unassigned_registrations import use_case as use_case_module

    async def fake_load(photo_id: str) -> LoadedUnassignedPhoto | None:
        if photo_id != _PET_PHOTO_REF:
            return None
        return LoadedUnassignedPhoto(
            full_bytes=b"dog-full",
            thumb_bytes=b"dog-thumb",
            content_type="image/webp",
            filename="dog.webp",
            width=640,
            height=480,
            original_size=2000,
            compressed_size=900,
            thumbnail_size=300,
        )

    monkeypatch.setattr(use_case_module, "load_unassigned_photo", fake_load)
    doc = await _seed_family_with_pets()
    dog, cat, bird = doc.household.pets or []
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected], claim_pets=True)

    assert response.status_code == 200
    body = response.json()
    assert body["pet_ids"] == [dog.pet_id, cat.pet_id]
    [image] = body["images"]
    assert base64.b64decode(image["full_b64"]) == b"dog-full"
    assert body["pets"] == [
        {"species": "dog", "count": 1, "has_cage": True, "image_url": image["doc"]["_id"]},
        {"species": "cat", "count": 1, "has_cage": False},
    ]
    assert body["household"]["pets"] == body["pets"]
    stored = {p.pet_id: p for p in await _stored_pets(doc.id)}
    assert [(stored[p.pet_id].status, stored[p.pet_id].claimed_by) for p in (dog, cat)] == [
        ("claimed", "kiosk:kiosk-7"),
        ("claimed", "kiosk:kiosk-7"),
    ]
    assert stored[dog.pet_id].claimed_shelter_code == "SH001"
    assert stored[bird.pet_id].status == "cancelled"


async def test_kiosk_prepare_with_claim_pets_claims_pets_even_when_one_member_is_left_open(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    selected, other_open, _ = (m.reserved_evacuee_id for m in doc.members)

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected], claim_pets=True)

    assert response.status_code == 200
    assert len(response.json()["pet_ids"]) == 2
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[other_open] == ("open", None)
    assert [p.status for p in await _stored_pets(doc.id)] == ["claimed", "claimed", "cancelled"]
    assert await _stored_status(doc.id) == "open"


async def test_kiosk_prepare_with_claim_pets_skips_a_pet_staff_already_claimed(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    dog, cat, _ = doc.household.pets or []
    dog.status = "claimed"
    dog.claimed_shelter_code = "SH002"
    dog.claimed_by = "staff-x"
    await doc.save()
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected], claim_pets=True)

    assert response.status_code == 200
    body = response.json()
    assert body["pet_ids"] == [cat.pet_id]
    assert [p["species"] for p in body["pets"]] == ["cat"]
    stored = {p.pet_id: p for p in await _stored_pets(doc.id)}
    assert (stored[dog.pet_id].claimed_shelter_code, stored[dog.pet_id].claimed_by) == (
        "SH002",
        "staff-x",
    )


async def test_kiosk_prepare_without_claim_pets_leaves_pets_open_and_returns_none(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected], claim_pets=False)

    assert response.status_code == 200
    body = response.json()
    assert (body["pets"], body["pet_ids"], body["household"]["pets"]) == ([], [], [])
    assert [p.status for p in await _stored_pets(doc.id)] == ["open", "open", "cancelled"]


async def test_kiosk_prepare_repeat_into_same_shelter_does_not_return_pets_again(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    selected = doc.members[0].reserved_evacuee_id
    first = await _prepare(client, auth_headers, doc.id, member_ids=[selected], claim_pets=True)
    assert len(first.json()["pet_ids"]) == 2

    again = await _prepare(client, auth_headers, doc.id, member_ids=[selected], claim_pets=True)

    assert again.status_code == 200
    body = again.json()
    assert (body["pets"], body["pet_ids"], body["household"]["pets"]) == ([], [], [])
    assert [e["_id"] for e in body["evacuees"]] == [selected]


async def test_kiosk_prepare_with_claim_pets_repairs_pets_when_members_are_already_claimed(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    already_here = doc.members[2].reserved_evacuee_id  # claimed in SH001 by kiosk:kiosk-1

    response = await _prepare(
        client, auth_headers, doc.id, member_ids=[already_here], claim_pets=True
    )

    assert response.status_code == 200
    assert len(response.json()["pet_ids"]) == 2
    assert [p.status for p in await _stored_pets(doc.id)] == ["claimed", "claimed", "cancelled"]


async def test_kiosk_prepare_with_claim_pets_closes_the_registration_when_nothing_is_left_open(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    first, second, _ = (m.reserved_evacuee_id for m in doc.members)

    response = await _prepare(
        client, auth_headers, doc.id, member_ids=[first, second], claim_pets=True
    )

    assert response.status_code == 200
    assert await _stored_status(doc.id) == "closed"


async def test_kiosk_prepare_keeps_the_registration_open_while_a_pet_is_left_open(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    first, second, _ = (m.reserved_evacuee_id for m in doc.members)

    response = await _prepare(client, auth_headers, doc.id, member_ids=[first, second])

    assert response.status_code == 200
    assert await _stored_status(doc.id) == "open"


async def test_kiosk_prepare_with_claim_pets_mints_a_pet_id_for_a_legacy_pet(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets(legacy_pet=True)
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(client, auth_headers, doc.id, member_ids=[selected], claim_pets=True)

    assert response.status_code == 200
    body = response.json()
    assert len(body["pet_ids"]) == 2
    assert all(pid.startswith("pet:") for pid in body["pet_ids"])
    stored = await _stored_pets(doc.id)
    assert [p.pet_id for p in stored if p.status == "claimed"] == body["pet_ids"]


async def test_kiosk_prepare_rejects_member_claimed_into_another_shelter_and_marks_nothing(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    open_member, _, claimed_in_sh001 = (m.reserved_evacuee_id for m in doc.members)

    response = await _prepare(
        client,
        auth_headers,
        doc.id,
        shelter_code="SH002",
        member_ids=[open_member, claimed_in_sh001],
    )

    assert response.status_code == 409
    assert response.json()["errors"][0]["error"]["code"] == "ALREADY_CLAIMED"
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[open_member] == ("open", None)
    assert members[claimed_in_sh001] == ("claimed", "SH001")


async def test_kiosk_prepare_rebuilds_docs_for_member_already_claimed_into_same_shelter(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    claimed_in_sh001 = doc.members[2].reserved_evacuee_id

    response = await _prepare(client, auth_headers, doc.id, member_ids=[claimed_in_sh001])

    assert response.status_code == 200
    body = response.json()
    assert [e["_id"] for e in body["evacuees"]] == [claimed_in_sh001]
    assert body["evacuees"][0]["current_stay"]["status"] == "pre_registered"
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[claimed_in_sh001] == ("claimed", "SH001")


async def test_kiosk_prepare_rejects_required_person_id_matching_no_member_and_marks_nothing(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(
        client,
        auth_headers,
        doc.id,
        member_ids=[selected],
        required_person_id="1111111111111",
    )

    assert response.status_code == 403
    assert response.json()["errors"][0]["error"]["code"] == "PERSON_MISMATCH"
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[selected] == ("open", None)


async def test_kiosk_prepare_accepts_required_person_id_of_a_member(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(
        client,
        auth_headers,
        doc.id,
        member_ids=[selected],
        required_person_id="9876543210987",
    )

    assert response.status_code == 200


async def test_kiosk_prepare_unknown_member_is_404_member_not_found(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    selected = doc.members[0].reserved_evacuee_id

    response = await _prepare(
        client, auth_headers, doc.id, member_ids=[selected, f"evacuee:{new_ulid()}"]
    )

    assert response.status_code == 404
    assert response.json()["errors"][0]["error"]["code"] == "MEMBER_NOT_FOUND"
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[selected] == ("open", None)


async def test_kiosk_prepare_unknown_registration_is_404_not_found(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await _prepare(
        client, auth_headers, new_ulid(), member_ids=[f"evacuee:{new_ulid()}"]
    )

    assert response.status_code == 404
    assert response.json()["errors"][0]["error"]["code"] == "NOT_FOUND"


async def test_kiosk_prepare_requires_service_bearer(client: AsyncClient) -> None:
    response = await client.post(
        _PREPARE_URL.format(registration_id=new_ulid()),
        json={"shelter_code": "SH001", "device_id": "kiosk-7", "member_ids": ["evacuee:x"]},
    )
    assert response.status_code == 401


async def test_kiosk_prepare_rejects_cancelled_member_with_member_not_open(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    doc.members[1].status = "cancelled"
    await doc.save()
    open_member, cancelled, _ = (m.reserved_evacuee_id for m in doc.members)

    response = await _prepare(client, auth_headers, doc.id, member_ids=[open_member, cancelled])

    assert response.status_code == 409
    assert response.json()["errors"][0]["error"]["code"] == "MEMBER_NOT_OPEN"
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[open_member] == ("open", None)


_REVERT_URL = "/public/v1/unassigned-registrations/{registration_id}/kiosk-claim/revert"


async def _revert(
    client: AsyncClient,
    headers: dict[str, str],
    registration_id: str,
    **body: object,
):
    payload = {"shelter_code": "SH001", "device_id": "kiosk-7", **body}
    return await client.post(
        _REVERT_URL.format(registration_id=registration_id), json=payload, headers=headers
    )


async def test_kiosk_revert_reopens_own_claim_and_makes_member_findable_by_citizen_id_again(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    selected, other_open, _ = (m.reserved_evacuee_id for m in doc.members)
    prepared = await _prepare(client, auth_headers, doc.id, member_ids=[selected])
    assert prepared.status_code == 200

    response = await _revert(client, auth_headers, doc.id, member_ids=[selected])

    assert response.status_code == 200
    assert response.json() == {"reverted": [selected], "reverted_pets": []}
    assert response.headers["cache-control"] == "no-store"
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[selected] == ("open", None)
    assert members[other_open] == ("open", None)
    found = await client.post(_URL, json={"citizen_id": "1234567890123"}, headers=auth_headers)
    assert found.status_code == 200
    assert found.json()["registration_id"] == doc.id


async def test_kiosk_revert_twice_reverts_nothing_the_second_time(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    selected = doc.members[0].reserved_evacuee_id
    await _prepare(client, auth_headers, doc.id, member_ids=[selected])
    first = await _revert(client, auth_headers, doc.id, member_ids=[selected])
    assert first.json() == {"reverted": [selected], "reverted_pets": []}

    second = await _revert(client, auth_headers, doc.id, member_ids=[selected])

    assert second.status_code == 200
    assert second.json() == {"reverted": [], "reverted_pets": []}


async def test_kiosk_revert_only_reverts_claims_made_by_that_kiosk_in_that_shelter(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    own = doc.members[0].reserved_evacuee_id
    by_other_kiosk = doc.members[2].reserved_evacuee_id  # claimed in SH001 by kiosk:kiosk-1
    by_staff = UnassignedMember(
        reserved_evacuee_id=f"evacuee:{new_ulid()}",
        status="claimed",
        first_name="ลุงสมศักดิ์",
        last_name="ใจดี",
        gender="male",
        claimed_shelter_code="SH001",
        claimed_by="staff-x",
    )
    other_shelter = UnassignedMember(
        reserved_evacuee_id=f"evacuee:{new_ulid()}",
        status="claimed",
        first_name="ป้าสมใจ",
        last_name="ใจดี",
        gender="female",
        claimed_shelter_code="SH002",
        claimed_by="kiosk:kiosk-7",
    )
    doc.members += [by_staff, other_shelter]
    await doc.save()
    await _prepare(client, auth_headers, doc.id, member_ids=[own])

    response = await _revert(
        client,
        auth_headers,
        doc.id,
        member_ids=[
            own,
            by_other_kiosk,
            by_staff.reserved_evacuee_id,
            other_shelter.reserved_evacuee_id,
        ],
    )

    assert response.status_code == 200
    assert response.json() == {"reverted": [own], "reverted_pets": []}
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[own] == ("open", None)
    assert members[by_other_kiosk] == ("claimed", "SH001")
    assert members[by_staff.reserved_evacuee_id] == ("claimed", "SH001")
    assert members[other_shelter.reserved_evacuee_id] == ("claimed", "SH002")


async def test_kiosk_revert_reopens_a_registration_the_claim_had_closed(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family()
    first, second, _ = (m.reserved_evacuee_id for m in doc.members)
    await _prepare(client, auth_headers, doc.id, member_ids=[first, second])
    status_url = f"/public/v1/unassigned-registrations/{doc.id}/status"
    closed = await client.get(status_url, headers=auth_headers)
    assert closed.json()["status"] == "closed"

    await _revert(client, auth_headers, doc.id, member_ids=[first, second])

    reopened = await client.get(status_url, headers=auth_headers)
    assert reopened.json()["status"] == "open"


async def test_kiosk_revert_with_pet_ids_reopens_this_kiosks_pets_and_the_registration(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    dog, cat, _ = doc.household.pets or []
    first, second, _ = (m.reserved_evacuee_id for m in doc.members)
    await _prepare(client, auth_headers, doc.id, member_ids=[first, second], claim_pets=True)
    assert await _stored_status(doc.id) == "closed"

    response = await _revert(
        client, auth_headers, doc.id, member_ids=[first], pet_ids=[dog.pet_id, cat.pet_id]
    )

    assert response.status_code == 200
    assert response.json() == {"reverted": [first], "reverted_pets": [dog.pet_id, cat.pet_id]}
    stored = await _stored_pets(doc.id)
    assert [(p.status, p.claimed_shelter_code, p.claimed_by, p.claimed_at) for p in stored[:2]] == [
        ("open", None, None, None)
    ] * 2
    assert await _stored_status(doc.id) == "open"
    members = await _lookup_members(client, auth_headers, doc.id)
    assert members[first] == ("open", None)
    assert members[second] == ("claimed", "SH001")


async def test_kiosk_revert_reopens_pets_alone_when_no_member_is_left_to_revert(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    dog, cat, _ = doc.household.pets or []
    already_here = doc.members[2].reserved_evacuee_id  # claimed in SH001 by kiosk:kiosk-1
    await _prepare(client, auth_headers, doc.id, member_ids=[already_here], claim_pets=True)

    response = await _revert(
        client, auth_headers, doc.id, member_ids=[already_here], pet_ids=[dog.pet_id, cat.pet_id]
    )

    assert response.status_code == 200
    assert response.json() == {"reverted": [], "reverted_pets": [dog.pet_id, cat.pet_id]}
    assert [p.status for p in await _stored_pets(doc.id)] == ["open", "open", "cancelled"]


async def test_kiosk_revert_accepts_pet_ids_without_member_ids(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    dog, cat, _ = doc.household.pets or []
    already_here = doc.members[2].reserved_evacuee_id
    await _prepare(client, auth_headers, doc.id, member_ids=[already_here], claim_pets=True)

    response = await _revert(
        client, auth_headers, doc.id, member_ids=[], pet_ids=[dog.pet_id, cat.pet_id]
    )

    assert response.status_code == 200
    assert response.json() == {"reverted": [], "reverted_pets": [dog.pet_id, cat.pet_id]}


async def test_kiosk_revert_without_member_or_pet_ids_is_422(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await _revert(client, auth_headers, new_ulid(), member_ids=[], pet_ids=[])

    assert response.status_code == 422


async def test_kiosk_revert_leaves_pets_claimed_by_another_actor_or_shelter_alone(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed_family_with_pets()
    dog, cat, _ = doc.household.pets or []
    first = doc.members[0].reserved_evacuee_id
    await _prepare(client, auth_headers, doc.id, member_ids=[first], claim_pets=True)
    stored = await UnassignedRegistration.get(doc.id)
    assert stored is not None
    by_staff, by_other_shelter = stored.household.pets[:2]
    by_staff.claimed_by = "staff-x"
    by_other_shelter.claimed_shelter_code = "SH002"
    await stored.save()

    response = await _revert(
        client, auth_headers, doc.id, member_ids=[first], pet_ids=[dog.pet_id, cat.pet_id]
    )

    assert response.status_code == 200
    assert response.json() == {"reverted": [first], "reverted_pets": []}
    assert [p.status for p in await _stored_pets(doc.id)] == ["claimed", "claimed", "cancelled"]


async def test_kiosk_revert_keeps_out_identity_keys_of_a_member_claimed_mid_revert(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """FR-KUC-16a: a claim landing between revert's read and write must not reopen its keys."""
    doc = await _seed_family()
    own, racing, _ = (m.reserved_evacuee_id for m in doc.members)
    await _prepare(client, auth_headers, doc.id, member_ids=[own])
    real_get = UnassignedRegistration.get
    raced = False

    async def get_then_race(document_id: str, *args: object, **kwargs: object):
        nonlocal raced
        found = await real_get(document_id, *args, **kwargs)
        if not raced:
            raced = True
            claimed = await _prepare(
                client, auth_headers, doc.id, member_ids=[racing], device_id="kiosk-9"
            )
            assert claimed.status_code == 200
        return found

    monkeypatch.setattr(UnassignedRegistration, "get", get_then_race)

    response = await _revert(client, auth_headers, doc.id, member_ids=[own])

    assert response.json() == {"reverted": [own], "reverted_pets": []}
    stored = await real_get(doc.id)
    assert stored is not None
    assert stored.open_person_id_numbers == ["1234567890123"]
    assert stored.open_phones == ["0812345678"]


async def test_kiosk_revert_unknown_registration_is_404_not_found(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await _revert(client, auth_headers, new_ulid(), member_ids=[f"evacuee:{new_ulid()}"])

    assert response.status_code == 404
    assert response.json()["errors"][0]["error"]["code"] == "NOT_FOUND"


async def test_kiosk_revert_requires_service_bearer(client: AsyncClient) -> None:
    response = await client.post(
        _REVERT_URL.format(registration_id=new_ulid()),
        json={"shelter_code": "SH001", "device_id": "kiosk-7", "member_ids": ["evacuee:x"]},
    )
    assert response.status_code == 401
