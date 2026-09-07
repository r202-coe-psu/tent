"""Create Unassigned Registration in Mongo only (CR-113 / FR-UR-01)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedPet,
    UnassignedRegistration,
)

from ...utils.masking import normalize_national_id, normalize_phone
from ...utils.ulid import new_ulid
from .schemas import (
    MemberCreated,
    MemberInput,
    PersonIdInput,
    UnassignedRegistrationCreateRequest,
    UnassignedRegistrationCreateResponse,
)


def _normalize_person_id(person_id: PersonIdInput | None) -> PersonId | None:
    if person_id is None:
        return None
    card_type = person_id.cardType
    number = person_id.number
    if card_type == "anonymous":
        # CR-112: system mints ANON-{ulid} when anonymous and number absent.
        if not number or not str(number).strip():
            number = f"ANON-{new_ulid()}"
        else:
            number = str(number).strip().upper()
            if not number.startswith("ANON-"):
                number = f"ANON-{new_ulid()}"
        return PersonId(cardType="anonymous", number=number)

    if number is None or not str(number).strip():
        return PersonId(cardType=card_type, number=None)

    raw = str(number).strip()
    if card_type == "national_id":
        raw = normalize_national_id(raw)
    elif card_type == "passport":
        raw = raw.upper()
    return PersonId(cardType=card_type, number=raw)


def _open_identity_keys(
    members: list[UnassignedMember],
) -> tuple[list[str], list[str]]:
    """Person-id numbers and phones for members still `open` (unique indexes)."""
    person_ids: list[str] = []
    phones: list[str] = []
    seen_ids: set[str] = set()
    seen_phones: set[str] = set()
    for member in members:
        if member.status != "open":
            continue
        if member.person_id and member.person_id.number:
            key = member.person_id.number.strip().upper()
            if key:
                if key in seen_ids:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={"error": "DUPLICATE_OPEN_IDENTITY"},
                    )
                seen_ids.add(key)
                person_ids.append(key)
        if member.phone:
            phone = normalize_phone(member.phone)
            if phone:
                if phone in seen_phones:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={"error": "DUPLICATE_OPEN_IDENTITY"},
                    )
                seen_phones.add(phone)
                phones.append(phone)
    return person_ids, phones


def _build_member(input_member: MemberInput) -> UnassignedMember:
    phone = normalize_phone(input_member.phone) if input_member.phone else None
    return UnassignedMember(
        reserved_evacuee_id=f"evacuee:{new_ulid()}",
        status="open",
        first_name=input_member.first_name,
        last_name=input_member.last_name or "",
        gender=input_member.gender,
        phone=phone or None,
        person_id=_normalize_person_id(input_member.person_id),
        country=input_member.country or "THAILAND",
        vulnerable_groups=list(input_member.vulnerable_groups),
        special_needs=list(input_member.special_needs),
        birth_year=input_member.birth_year,
        age=input_member.age,
        nickname=input_member.nickname,
        religion=input_member.religion,
    )


def _member_response(member: UnassignedMember) -> MemberCreated:
    person_id = None
    if member.person_id is not None:
        person_id = PersonIdInput(
            cardType=member.person_id.cardType,
            number=member.person_id.number,
        )
    return MemberCreated(
        reserved_evacuee_id=member.reserved_evacuee_id,
        status=member.status,
        first_name=member.first_name,
        last_name=member.last_name,
        gender=member.gender,
        phone=member.phone,
        person_id=person_id,
        country=member.country,
        vulnerable_groups=list(member.vulnerable_groups),
        special_needs=list(member.special_needs),
    )


class UnassignedRegistrationsUseCase:
    async def create(
        self, payload: UnassignedRegistrationCreateRequest
    ) -> UnassignedRegistrationCreateResponse:
        now = datetime.now(UTC)
        members = [_build_member(m) for m in payload.members]
        open_person_ids, open_phones = _open_identity_keys(members)

        household = UnassignedHousehold(
            housing_type=payload.household.housing_type,
            residence_landmark=payload.household.residence_landmark,
            address_no=payload.household.address_no,
            village_no=payload.household.village_no,
            subdistrict=payload.household.subdistrict,
            district=payload.household.district,
            province=payload.household.province,
            postal_code=payload.household.postal_code,
            geo=payload.household.geo,
            pets=[
                UnassignedPet(
                    species=pet.species,
                    count=pet.count,
                    notes=pet.notes,
                    has_cage=pet.has_cage,
                )
                for pet in payload.household.pets
            ],
            label=payload.household.label,
        )

        doc = UnassignedRegistration(
            id=new_ulid(),
            schema_v=1,
            reserved_household_id=f"household:{new_ulid()}",
            members=members,
            household=household,
            status="open",
            registered_via=payload.registered_via,
            created_at=now,
            open_person_id_numbers=open_person_ids,
            open_phones=open_phones,
        )

        try:
            await doc.insert()
        except DuplicateKeyError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "DUPLICATE_OPEN_IDENTITY"},
            ) from exc

        return UnassignedRegistrationCreateResponse(
            id=doc.id,
            schema_v=doc.schema_v,
            reserved_household_id=doc.reserved_household_id,
            members=[_member_response(m) for m in doc.members],
            registered_via=doc.registered_via,
            status=doc.status,
            created_at=doc.created_at.isoformat(),
        )


def get_unassigned_registrations_use_case() -> UnassignedRegistrationsUseCase:
    return UnassignedRegistrationsUseCase()
