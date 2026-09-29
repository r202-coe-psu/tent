"""Unassigned Registration create + staff search/claim/purge (CR-113)."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError, PyMongoError
from tent_model.unassigned_registration import (
    UNASSIGNED_SCHEMA_V,
    EmergencyContact,
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedPet,
    UnassignedRegistration,
)

from ...core.staff_session import StaffSession
from ...infrastructure.gridfs import load_unassigned_photo, parse_photo_ref
from ...utils.masking import (
    mask_last_name,
    mask_phone,
    normalize_national_id,
    normalize_phone,
)
from ...utils.ulid import new_ulid
from .couch_birth import (
    CouchBirthError,
    CouchBirthPort,
    CouchImagePayload,
    build_couch_evacuee,
    build_couch_household,
    build_couch_image,
    build_couch_pet,
    couch_unavailable,
    get_couch_birth,
)
from .schemas import (
    ClaimedMemberOut,
    ClaimedPetOut,
    EmergencyContactOut,
    HouseholdOut,
    MemberCreated,
    MemberInput,
    OpenMemberHit,
    OpenPetHit,
    PersonIdInput,
    PersonIdOut,
    PetCreated,
    PetInput,
    UnassignedRegistrationClaimRequest,
    UnassignedRegistrationClaimResponse,
    UnassignedRegistrationCreateRequest,
    UnassignedRegistrationCreateResponse,
    UnassignedRegistrationDetailResponse,
    UnassignedRegistrationListItem,
    UnassignedRegistrationListResponse,
    UnassignedRegistrationSearchHit,
    UnassignedRegistrationSearchResponse,
    UnassignedRegistrationStatsResponse,
    UnassignedResidenceMatchHit,
    UnassignedResidenceMatchRequest,
    UnassignedResidenceMatchResponse,
)

logger = logging.getLogger(__name__)

# Same shape as staff Anonymous ID (CR-112): ANON- + Crockford ULID.
_ANON_ID_RE = re.compile(r"^ANON-[0-9A-HJKMNP-TV-Z]{26}$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class ClaimMarkParams:
    """Atomic Mongo mark/lock before Couch birth (CR-113 option B)."""

    registration_id: str
    member_ids: list[str]
    pet_ids: list[str]
    shelter_code: str
    actor: str
    claimed_at: datetime
    open_person_id_numbers: list[str]
    open_phones: list[str]
    document_status: str


@dataclass(frozen=True, slots=True)
class ClaimRevertParams:
    """Undo a prior mark when Couch birth fails."""

    registration_id: str
    member_ids: list[str]
    pet_ids: list[str]
    open_person_id_numbers: list[str]
    open_phones: list[str]
    document_status: str


def _new_pet_id() -> str:
    return f"pet:{new_ulid()}"


def _build_pet(input_pet: PetInput) -> UnassignedPet:
    # Prefer one animal per row for new writes (count may still be >1 for rare clients).
    return UnassignedPet(
        pet_id=_new_pet_id(),
        status="open",
        species=input_pet.species,
        count=input_pet.count,
        notes=input_pet.notes,
        has_cage=input_pet.has_cage,
        image_url=_normalize_photo_ref(input_pet.image_url),
    )


def _ensure_pet_ids(doc: UnassignedRegistration) -> bool:
    """Mint pet_id on legacy rows lacking one. Returns True if any field changed."""
    changed = False
    for pet in doc.household.pets or []:
        if not pet.pet_id:
            pet.pet_id = _new_pet_id()
            changed = True
        if pet.status is None:
            pet.status = "open"
            changed = True
    return changed


def _open_pets(doc: UnassignedRegistration) -> list[UnassignedPet]:
    return [p for p in (doc.household.pets or []) if p.is_open()]


def _is_anonymous_id(value: str) -> bool:
    return bool(_ANON_ID_RE.match(value.strip()))


def _normalize_person_id(person_id: PersonIdInput | None) -> PersonId | None:
    if person_id is None:
        return None
    card_type = person_id.cardType
    number = person_id.number
    if card_type == "anonymous":
        # CR-112: mint ANON-{ulid} when anonymous and number absent.
        # Reject non-ANON values instead of silently reminting (caller intent preserved).
        if not number or not str(number).strip():
            number = f"ANON-{new_ulid()}"
        else:
            number = str(number).strip().upper()
            if not _is_anonymous_id(number):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"error": "INVALID_ANONYMOUS_ID"},
                )
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


def _existing_identity_keys(
    members: list[UnassignedMember],
) -> tuple[set[str], set[str]]:
    """Person-id numbers and phones across *every* member, regardless of status.

    Unlike `_open_identity_keys` (open-only — feeds the Mongo unique-index
    fields, which intentionally free up once a member is claimed elsewhere),
    this is used to guard a *join*: a late joiner must not be allowed to reuse
    the identity of someone already on this same document, even if that
    someone has already been claimed into Couch.
    """
    person_ids: set[str] = set()
    phones: set[str] = set()
    for member in members:
        if member.person_id and member.person_id.number:
            key = member.person_id.number.strip().upper()
            if key:
                person_ids.add(key)
        if member.phone:
            phones.add(member.phone)
    return person_ids, phones


def _normalize_emergency_contact(
    contact: object | None,
) -> EmergencyContact | None:
    if contact is None:
        return None
    name = getattr(contact, "name", "") or ""
    phone = getattr(contact, "phone", "") or ""
    relation = getattr(contact, "relation", "") or ""
    name = name.strip() if isinstance(name, str) else ""
    phone = phone.strip() if isinstance(phone, str) else ""
    relation = relation.strip() if isinstance(relation, str) else ""
    if not name and not phone and not relation:
        return None
    return EmergencyContact(name=name, phone=phone, relation=relation)


def _normalize_photo_ref(photo: str | None) -> str | None:
    if not photo:
        return None
    raw = photo.strip()
    if not raw:
        return None
    if parse_photo_ref(raw) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "INVALID_PHOTO_REF"},
        )
    return raw if raw.startswith("gfs:") else f"gfs:{raw}"


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
        emergency_contact=_normalize_emergency_contact(input_member.emergency_contact),
        photo=_normalize_photo_ref(input_member.photo),
    )


def _norm_addr(value: str | None) -> str:
    if not value:
        return ""
    s = value.strip().lower()
    if not s:
        return ""
    thai_nums = "๐๑๒๓๔๕๖๗๘๙"
    for i, ch in enumerate(thai_nums):
        s = s.replace(ch, str(i))
    s = re.sub(r"ถ\.\s*", "ถนน", s)
    s = re.sub(r"ซ\.\s*", "ซอย", s)
    s = re.sub(r"ม\.\s*", "หมู่", s)
    s = re.sub(r"หมู่ที่\s*", "หมู่", s)
    s = re.sub(r"จ\.\s*", "จังหวัด", s)
    s = re.sub(r"อ\.\s*", "อำเภอ", s)
    s = re.sub(r"ต\.\s*", "ตำบล", s)
    s = re.sub(r"^(จังหวัด|อำเภอ|ตำบล)\s*", "", s)
    s = re.sub(r"(ถนน|ซอย|หมู่|ตำบล|อำเภอ|จังหวัด)\s*([0-9]+)", r"\1 \2", s)
    s = re.sub(r"\s*([/\-])\s*", r"\1", s)
    s = re.sub(r"[ก-ฮ]?\u0E4C", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _residence_matches(
    query: UnassignedResidenceMatchRequest, household: UnassignedHousehold
) -> bool:
    """Mirror frontend matchesResidenceAddress (incl. homeless landmark + geo)."""
    homeless = query.housing_type == "homeless" or (
        not _norm_addr(query.address_no) and bool(_norm_addr(query.residence_landmark))
    )
    if homeless:
        if not _norm_addr(query.residence_landmark):
            return False
        if _norm_addr(query.residence_landmark) != _norm_addr(household.residence_landmark):
            return False
        if _norm_addr(query.subdistrict) != _norm_addr(household.subdistrict):
            return False
        if _norm_addr(query.district) != _norm_addr(household.district):
            return False
        if _norm_addr(query.province) != _norm_addr(household.province):
            return False
        return True

    if _norm_addr(query.address_no) != _norm_addr(household.address_no):
        return False
    if _norm_addr(query.subdistrict) != _norm_addr(household.subdistrict):
        return False
    if _norm_addr(query.district) != _norm_addr(household.district):
        return False
    if _norm_addr(query.province) != _norm_addr(household.province):
        return False
    query_village = (query.village_no or "").strip()
    if query_village and _norm_addr(query.village_no) != _norm_addr(household.village_no):
        return False
    return True


def _emergency_out(member: UnassignedMember) -> EmergencyContactOut | None:
    if member.emergency_contact is None:
        return None
    return EmergencyContactOut(
        name=member.emergency_contact.name,
        phone=member.emergency_contact.phone,
        relation=member.emergency_contact.relation,
    )


def _member_response(member: UnassignedMember) -> MemberCreated:
    person_id = None
    if member.person_id is not None:
        person_id = PersonIdOut(
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
        birth_year=member.birth_year,
        age=member.age,
        nickname=member.nickname,
        religion=member.religion,
        emergency_contact=_emergency_out(member),
        photo=member.photo,
    )


class UnassignedRegistrationsUseCase:
    def __init__(self, couch_birth: CouchBirthPort | None = None) -> None:
        self._couch_birth = couch_birth or get_couch_birth()

    async def create(
        self, payload: UnassignedRegistrationCreateRequest
    ) -> UnassignedRegistrationCreateResponse:
        join_id = (payload.join_registration_id or "").strip()
        if join_id:
            return await self._join_existing(payload, join_id)

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
            pets=[_build_pet(pet) for pet in payload.household.pets],
            label=payload.household.label,
        )

        doc = UnassignedRegistration(
            id=new_ulid(),
            schema_v=UNASSIGNED_SCHEMA_V,
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

    async def _join_existing(
        self, payload: UnassignedRegistrationCreateRequest, join_id: str
    ) -> UnassignedRegistrationCreateResponse:
        """Append members (+ pets) into an existing family doc (open or closed → reopen)."""
        try:
            doc = await UnassignedRegistration.get(join_id)
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("join") from exc

        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error": "JOIN_TARGET_NOT_FOUND"},
            )

        _ensure_pet_ids(doc)

        existing_person_ids, existing_phones = _existing_identity_keys(doc.members)
        new_members = [_build_member(m) for m in payload.members]
        for member in new_members:
            key = (
                member.person_id.number.strip().upper()
                if member.person_id and member.person_id.number
                else ""
            )
            if key and key in existing_person_ids:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"error": "DUPLICATE_OPEN_IDENTITY"},
                )
            if member.phone and member.phone in existing_phones:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"error": "DUPLICATE_OPEN_IDENTITY"},
                )

        combined = list(doc.members) + new_members
        open_person_ids, open_phones = _open_identity_keys(combined)

        append_pets = [_build_pet(pet) for pet in payload.household.pets]
        if append_pets:
            existing_pets = list(doc.household.pets or [])
            doc.household.pets = existing_pets + append_pets

        doc.members = combined
        doc.open_person_id_numbers = open_person_ids
        doc.open_phones = open_phones
        # Late join always reopens the family document.
        doc.status = "open"
        if doc.schema_v < UNASSIGNED_SCHEMA_V:
            doc.schema_v = UNASSIGNED_SCHEMA_V

        try:
            await doc.save()
        except DuplicateKeyError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "DUPLICATE_OPEN_IDENTITY"},
            ) from exc
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("join") from exc

        return UnassignedRegistrationCreateResponse(
            id=doc.id,
            schema_v=doc.schema_v,
            reserved_household_id=doc.reserved_household_id,
            members=[_member_response(m) for m in doc.members],
            registered_via=doc.registered_via,
            status=doc.status,
            created_at=doc.created_at.isoformat(),
        )

    async def match_by_residence(
        self, payload: UnassignedResidenceMatchRequest
    ) -> UnassignedResidenceMatchResponse:
        """Return registrations whose Residence matches — ids + non-PII chips only."""
        try:
            docs = await UnassignedRegistration.find(
                {"status": {"$in": ["open", "closed", "claimed", "partial_claim"]}}
            ).to_list()
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("residence_match") from exc

        query_phone = normalize_phone(payload.phone) if payload.phone else None

        matches: list[UnassignedResidenceMatchHit] = []
        for doc in docs:
            # Match ANY member phone (open or claimed). Uniqueness still uses
            # open_phones only; residence-match must find closed/history docs so
            # late joiners can append via join_registration_id.
            phone_match = False
            matched_member_str: str | None = None
            if query_phone:
                for m in doc.members:
                    if not m.phone:
                        continue
                    if normalize_phone(m.phone) != query_phone:
                        continue
                    phone_match = True
                    head = doc.members[0] if doc.members else None
                    head_phone = normalize_phone(head.phone) if (head and head.phone) else ""
                    if head is None or m.reserved_evacuee_id != head.reserved_evacuee_id:
                        if head_phone != query_phone:
                            first_char = m.first_name[0] if m.first_name else ""
                            matched_member_str = f"คุณ{first_char}*** ({mask_phone(m.phone)})"
                    break

            residence_match = _residence_matches(payload, doc.household)
            if not phone_match and not residence_match:
                continue

            landmark = (doc.household.residence_landmark or "").strip() or None
            housing = doc.household.housing_type
            claimed_shelter = None
            for m in doc.members:
                if m.claimed_shelter_code:
                    claimed_shelter = m.claimed_shelter_code
                    break

            primary_masked = None
            if doc.members:
                head = doc.members[0]
                masked_last = mask_last_name(head.last_name) if head.last_name else ""
                primary_masked = f"{head.first_name} {masked_last}".strip()

            pets_list = [
                p.model_dump() if hasattr(p, "model_dump") else p
                for p in (doc.household.pets or [])
            ]
            hh_addr = {
                "housing_type": doc.household.housing_type,
                "residence_landmark": doc.household.residence_landmark,
                "address_no": doc.household.address_no,
                "village_no": doc.household.village_no,
                "subdistrict": doc.household.subdistrict,
                "district": doc.household.district,
                "province": doc.household.province,
                "postal_code": doc.household.postal_code,
                "latitude": doc.household.geo.coordinates[1] if doc.household.geo else None,
                "longitude": doc.household.geo.coordinates[0] if doc.household.geo else None,
            }

            matches.append(
                UnassignedResidenceMatchHit(
                    id=doc.id,
                    landmark=landmark,
                    housing_type=housing,
                    claimed_shelter_code=claimed_shelter,
                    claimed_household_id=doc.reserved_household_id if claimed_shelter else None,
                    status=doc.status,
                    primary_contact_name_masked=primary_masked,
                    matched_member_masked=matched_member_str,
                    member_count=len(doc.members),
                    pets=pets_list,
                    household_address=hh_addr,
                )
            )
            if len(matches) >= 25:
                break

        return UnassignedResidenceMatchResponse(matches=matches)

    async def stats(self) -> UnassignedRegistrationStatsResponse:
        """Open-queue headcounts for SA overview KPIs."""
        try:
            docs = await UnassignedRegistration.find({"status": "open"}).to_list()
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("stats") from exc
        open_members = sum(1 for doc in docs for m in doc.members if m.status == "open")
        return UnassignedRegistrationStatsResponse(
            open_registrations=len(docs),
            open_members=open_members,
        )

    async def list_open(
        self,
        *,
        q: str = "",
        province: str | None = None,
        district: str | None = None,
        subdistrict: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> UnassignedRegistrationListResponse:
        """Paginated open Unassigned Registrations for SA overview (PII — SA gate)."""
        try:
            docs = (
                await UnassignedRegistration.find({"status": "open"}).sort("-created_at").to_list()
            )
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("list") from exc

        query = q.strip()
        filtered: list[UnassignedRegistration] = []
        for doc in docs:
            hh = doc.household
            if province and (hh.province or "").strip() != province.strip():
                continue
            if district and (hh.district or "").strip() != district.strip():
                continue
            if subdistrict and (hh.subdistrict or "").strip() != subdistrict.strip():
                continue
            open_members = [m for m in doc.members if m.status == "open"]
            open_pet_rows = _open_pets(doc)
            if not open_members and not open_pet_rows:
                continue
            if query:
                if not (
                    _identity_keys_match(doc, query)
                    or doc.id == query
                    or any(_member_matches_query(m, query) for m in open_members)
                ):
                    continue
            filtered.append(doc)

        total = len(filtered)
        open_member_count = sum(1 for doc in filtered for m in doc.members if m.status == "open")
        page = filtered[offset : offset + limit]
        items = [_list_item(doc) for doc in page]
        return UnassignedRegistrationListResponse(
            items=items,
            total=total,
            open_member_count=open_member_count,
            limit=limit,
            offset=offset,
        )

    async def get_detail(self, registration_id: str) -> UnassignedRegistrationDetailResponse:
        """Full Unassigned Registration for SA read-only profile."""
        try:
            doc = await UnassignedRegistration.get(registration_id)
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("get") from exc
        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "Unassigned Registration not found",
                    }
                },
            )
        return _detail_response(doc)

    async def search(self, raw_query: str) -> UnassignedRegistrationSearchResponse:
        """Search open members on the Mongo queue (FR-UR-02) — no public_persons."""
        query = raw_query.strip()
        if not query:
            return UnassignedRegistrationSearchResponse(results=[])

        mongo_filter = _open_member_search_filter(query)
        try:
            docs = await UnassignedRegistration.find(mongo_filter).sort("-created_at").to_list()
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("search") from exc

        results: list[UnassignedRegistrationSearchHit] = []
        for doc in docs:
            _ensure_pet_ids(doc)
            open_members = [
                _open_member_hit(m)
                for m in doc.members
                if m.status == "open" and _member_matches_query(m, query)
            ]
            if not open_members:
                # Doc matched via denormalized keys / registration id but no open
                # member text-match — still include all open members.
                if _identity_keys_match(doc, query) or doc.id == query.strip():
                    open_members = [_open_member_hit(m) for m in doc.members if m.status == "open"]
            open_pet_hits = [_open_pet_hit(p) for p in _open_pets(doc)]
            if not open_members and not open_pet_hits:
                continue
            # Only surface pet-only hits when query matched the registration id / keys
            # (or there was an open-member match on this doc).
            if not open_members and not (
                _identity_keys_match(doc, query) or doc.id == query.strip()
            ):
                continue
            results.append(
                UnassignedRegistrationSearchHit(
                    id=doc.id,
                    reserved_household_id=doc.reserved_household_id,
                    registered_via=doc.registered_via,
                    status=doc.status,
                    created_at=doc.created_at.isoformat(),
                    open_members=open_members,
                    open_pets=open_pet_hits,
                )
            )
        return UnassignedRegistrationSearchResponse(results=results)

    async def hard_delete(self, registration_id: str) -> None:
        """system_admin purge of a central-queue document (FR-UR-04) — no claim required."""
        try:
            doc = await UnassignedRegistration.get(registration_id)
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("purge") from exc
        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "Unassigned Registration not found",
                    }
                },
            )
        try:
            await doc.delete()
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("purge") from exc

    async def claim(
        self,
        registration_id: str,
        payload: UnassignedRegistrationClaimRequest,
        session: StaffSession,
        *,
        cookie_header: str | None,
    ) -> UnassignedRegistrationClaimResponse:
        """Partial/full claim → Couch birth at pre_registered (FR-UR-03/04 + pets)."""
        shelter_code = _resolve_claim_shelter(session, payload.shelter_code)
        member_ids = list(payload.member_ids)
        pet_ids = list(payload.pet_ids)

        try:
            doc = await UnassignedRegistration.get(registration_id)
        except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
            raise _mongo_unavailable("claim") from exc
        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "Unassigned Registration not found",
                    }
                },
            )

        if _ensure_pet_ids(doc):
            try:
                await doc.save()
            except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
                raise _mongo_unavailable("claim") from exc

        by_id = {m.reserved_evacuee_id: m for m in doc.members}
        by_pet_id = {p.pet_id: p for p in (doc.household.pets or []) if p.pet_id}

        missing = [mid for mid in member_ids if mid not in by_id]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": {
                        "code": "MEMBER_NOT_FOUND",
                        "message": "One or more member ids are not on this registration",
                    }
                },
            )

        missing_pets = [pid for pid in pet_ids if pid not in by_pet_id]
        if missing_pets:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": {
                        "code": "PET_NOT_FOUND",
                        "message": "One or more pet ids are not on this registration",
                        "pet_ids": missing_pets,
                    }
                },
            )

        already_claimed = [mid for mid in member_ids if by_id[mid].status == "claimed"]
        if already_claimed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "ALREADY_CLAIMED",
                        "message": "One or more members were already claimed",
                        "member_ids": already_claimed,
                    }
                },
            )

        already_claimed_pets = [
            pid for pid in pet_ids if by_pet_id[pid].effective_status() == "claimed"
        ]
        if already_claimed_pets:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "PET_ALREADY_CLAIMED",
                        "message": "One or more pets were already claimed",
                        "pet_ids": already_claimed_pets,
                    }
                },
            )

        not_open = [mid for mid in member_ids if by_id[mid].status != "open"]
        if not_open:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "MEMBER_NOT_OPEN",
                        "message": "Only open members can be claimed",
                        "member_ids": not_open,
                    }
                },
            )

        pets_not_open = [pid for pid in pet_ids if not by_pet_id[pid].is_open()]
        if pets_not_open:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "PET_NOT_OPEN",
                        "message": "Only open pets can be claimed",
                        "pet_ids": pets_not_open,
                    }
                },
            )

        claim_targets = [by_id[mid] for mid in member_ids]
        claim_pet_targets = [by_pet_id[pid] for pid in pet_ids]
        member_id_set = set(member_ids)
        pet_id_set = set(pet_ids)
        now = datetime.now(UTC)

        remaining_members = [
            m
            for m in doc.members
            if m.status == "open" and m.reserved_evacuee_id not in member_id_set
        ]
        remaining_pets = [
            p
            for p in (doc.household.pets or [])
            if p.is_open() and (p.pet_id or "") not in pet_id_set
        ]
        next_open_ids, next_open_phones = _open_identity_keys(remaining_members)
        next_doc_status = "open" if remaining_members or remaining_pets else "closed"

        # Pets-only claim still needs a head for first household birth.
        head_member: UnassignedMember | None = claim_targets[0] if claim_targets else None
        if head_member is None:
            head_member = next(
                (m for m in doc.members if m.status == "claimed"),
                None,
            ) or (doc.members[0] if doc.members else None)
        if head_member is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "error": {
                        "code": "NO_HOUSEHOLD_HEAD",
                        "message": (
                            "Cannot claim pets without a household member on the registration"
                        ),
                    }
                },
            )

        # Option B: atomic Mongo mark/lock first, then Couch birth (revert on failure).
        mark = ClaimMarkParams(
            registration_id=doc.id,
            member_ids=member_ids,
            pet_ids=pet_ids,
            shelter_code=shelter_code,
            actor=session.name,
            claimed_at=now,
            open_person_id_numbers=next_open_ids,
            open_phones=next_open_phones,
            document_status=next_doc_status,
        )
        claimed = await _atomic_mark_claimed(mark)
        if not claimed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "ALREADY_CLAIMED",
                        "message": "One or more members or pets were already claimed",
                    }
                },
            )

        # Resolve GridFS face + pet photos → Couch image:{ulid} before birth (#255).
        photo_by_member: dict[str, str] = {}
        pet_image_urls: dict[str, str] = {}
        image_payloads: list[CouchImagePayload] = []

        async def _append_gridfs_image(photo_ref: str, *, label: str) -> str | None:
            loaded = await load_unassigned_photo(photo_ref)
            if loaded is None:
                logger.warning(
                    "Unassigned claim: GridFS photo missing for %s (%s)",
                    label,
                    photo_ref,
                )
                return None
            image_id = f"image:{new_ulid()}"
            image_doc = build_couch_image(
                image_id=image_id,
                shelter_code=shelter_code,
                actor=session.name,
                now=now,
                filename=loaded.filename,
                content_type=loaded.content_type,
                width=loaded.width or 0,
                height=loaded.height or 0,
                original_size=loaded.original_size or len(loaded.full_bytes),
                compressed_size=loaded.compressed_size or len(loaded.full_bytes),
                thumbnail_size=loaded.thumbnail_size
                or len(loaded.thumb_bytes or loaded.full_bytes),
            )
            image_payloads.append(
                CouchImagePayload(
                    doc=image_doc,
                    full_bytes=loaded.full_bytes,
                    thumb_bytes=loaded.thumb_bytes or loaded.full_bytes,
                    content_type=loaded.content_type,
                )
            )
            return image_id

        for member in claim_targets:
            if not member.photo:
                continue
            image_id = await _append_gridfs_image(member.photo, label=member.reserved_evacuee_id)
            if image_id:
                photo_by_member[member.reserved_evacuee_id] = image_id

        for pet in claim_pet_targets:
            if not pet.image_url or not pet.pet_id:
                continue
            image_id = await _append_gridfs_image(pet.image_url, label=pet.pet_id)
            if image_id:
                pet_image_urls[pet.pet_id] = image_id

        couch_pets = [
            build_couch_pet(pet, image_url=pet_image_urls.get(pet.pet_id or ""))
            for pet in claim_pet_targets
        ]
        household_doc = build_couch_household(
            doc,
            head_member,
            shelter_code,
            session.name,
            now,
            pets=claim_pet_targets,
            pet_image_urls=pet_image_urls or None,
        )

        evacuee_docs = [
            build_couch_evacuee(
                member,
                doc.reserved_household_id,
                shelter_code,
                session.name,
                now,
                doc,
                photo=photo_by_member.get(member.reserved_evacuee_id),
            )
            for member in claim_targets
        ]

        try:
            await self._couch_birth.birth(
                shelter_code=shelter_code,
                household_doc=household_doc,
                evacuee_docs=evacuee_docs,
                cookie_header=cookie_header,
                image_payloads=image_payloads,
                append_pets=couch_pets if claim_pet_targets else None,
            )
        except CouchBirthError as exc:
            await _atomic_revert_claim(
                ClaimRevertParams(
                    registration_id=doc.id,
                    member_ids=member_ids,
                    pet_ids=pet_ids,
                    open_person_id_numbers=list(doc.open_person_id_numbers),
                    open_phones=list(doc.open_phones),
                    document_status=doc.status,
                )
            )
            raise couch_unavailable(
                "Unassigned Registration claim requires central Couch for Evacuee birth"
            ) from exc

        claimed_out = [
            ClaimedMemberOut(
                reserved_evacuee_id=m.reserved_evacuee_id,
                first_name=m.first_name,
                last_name=m.last_name,
            )
            for m in claim_targets
        ]
        claimed_pets_out = [
            ClaimedPetOut(
                pet_id=p.pet_id or "",
                species=p.species,
                count=p.count,
            )
            for p in claim_pet_targets
        ]

        # Retain Mongo document always (no hard-delete after full claim).
        return UnassignedRegistrationClaimResponse(
            id=doc.id,
            deleted=False,
            shelter_code=shelter_code,
            household_id=doc.reserved_household_id,
            evacuee_ids=member_ids,
            claimed=claimed_out,
            claimed_pets=claimed_pets_out,
            remaining_open=[_open_member_hit(m) for m in remaining_members],
            remaining_open_pets=[_open_pet_hit(p) for p in remaining_pets],
        )


def _resolve_claim_shelter(session: StaffSession, requested: str | None) -> str:
    if session.is_sa:
        if not requested:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "error": {
                        "code": "SHELTER_REQUIRED",
                        "message": "system_admin claim requires shelter_code",
                    }
                },
            )
        return requested
    if not session.shelter_code:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": {
                    "code": "FORBIDDEN",
                    "message": "Claim requires shelter scope",
                }
            },
        )
    if requested and requested != session.shelter_code:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": {
                    "code": "FORBIDDEN",
                    "message": "Cannot claim into another shelter",
                }
            },
        )
    return session.shelter_code


async def _atomic_mark_claimed(params: ClaimMarkParams) -> bool:
    collection = UnassignedRegistration.get_pymongo_collection()
    and_clauses: list[dict] = []
    for mid in params.member_ids:
        and_clauses.append(
            {
                "members": {
                    "$elemMatch": {
                        "reserved_evacuee_id": mid,
                        "status": "open",
                    }
                }
            }
        )
    for pid in params.pet_ids:
        and_clauses.append(
            {
                "household.pets": {
                    "$elemMatch": {
                        "pet_id": pid,
                        "status": "open",
                    }
                }
            }
        )

    set_fields: dict = {
        "open_person_id_numbers": params.open_person_id_numbers,
        "open_phones": params.open_phones,
        "status": params.document_status,
        "schema_v": UNASSIGNED_SCHEMA_V,
    }
    array_filters: list[dict] = []
    if params.member_ids:
        set_fields["members.$[m].status"] = "claimed"
        set_fields["members.$[m].claimed_shelter_code"] = params.shelter_code
        set_fields["members.$[m].claimed_by"] = params.actor
        set_fields["members.$[m].claimed_at"] = params.claimed_at
        array_filters.append(
            {
                "m.reserved_evacuee_id": {"$in": params.member_ids},
                "m.status": "open",
            }
        )
    if params.pet_ids:
        set_fields["household.pets.$[p].status"] = "claimed"
        set_fields["household.pets.$[p].claimed_shelter_code"] = params.shelter_code
        set_fields["household.pets.$[p].claimed_by"] = params.actor
        set_fields["household.pets.$[p].claimed_at"] = params.claimed_at
        array_filters.append(
            {
                "p.pet_id": {"$in": params.pet_ids},
                "p.status": "open",
            }
        )

    filter_query: dict = {"_id": params.registration_id}
    if and_clauses:
        filter_query["$and"] = and_clauses

    result = await collection.update_one(
        filter_query,
        {"$set": set_fields},
        array_filters=array_filters or None,
    )
    return result.modified_count == 1


async def _atomic_revert_claim(params: ClaimRevertParams) -> None:
    collection = UnassignedRegistration.get_pymongo_collection()
    set_fields: dict = {
        "open_person_id_numbers": params.open_person_id_numbers,
        "open_phones": params.open_phones,
        "status": params.document_status,
    }
    array_filters: list[dict] = []
    if params.member_ids:
        set_fields["members.$[m].status"] = "open"
        set_fields["members.$[m].claimed_shelter_code"] = None
        set_fields["members.$[m].claimed_by"] = None
        set_fields["members.$[m].claimed_at"] = None
        array_filters.append(
            {
                "m.reserved_evacuee_id": {"$in": params.member_ids},
                "m.status": "claimed",
            }
        )
    if params.pet_ids:
        set_fields["household.pets.$[p].status"] = "open"
        set_fields["household.pets.$[p].claimed_shelter_code"] = None
        set_fields["household.pets.$[p].claimed_by"] = None
        set_fields["household.pets.$[p].claimed_at"] = None
        array_filters.append(
            {
                "p.pet_id": {"$in": params.pet_ids},
                "p.status": "claimed",
            }
        )
    await collection.update_one(
        {"_id": params.registration_id},
        {"$set": set_fields},
        array_filters=array_filters or None,
    )


def _mongo_unavailable(action: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": {
                "code": "ONLINE_REQUIRED",
                "message": f"Unassigned Registration {action} requires central Mongo",
            }
        },
    )


def _escape_regex(value: str) -> str:
    return re.escape(value)


def _open_member_search_filter(query: str) -> dict:
    """Mongo filter: documents with at least one open member matching q.

    Also matches registration ``_id`` so unassigned ticket QR (Mongo id) resolves.
    """
    compact = re.sub(r"[\s\-]+", "", query)
    phone = normalize_phone(compact) if compact else ""
    nid = normalize_national_id(compact) if compact.isdigit() and len(compact) == 13 else ""
    or_clauses: list[dict] = [
        {"_id": query},
        {
            "members": {
                "$elemMatch": {
                    "status": "open",
                    "first_name": {"$regex": _escape_regex(query), "$options": "i"},
                }
            }
        },
        {
            "members": {
                "$elemMatch": {
                    "status": "open",
                    "last_name": {"$regex": _escape_regex(query), "$options": "i"},
                }
            }
        },
        {
            "members": {
                "$elemMatch": {
                    "status": "open",
                    "person_id.number": {
                        "$regex": _escape_regex(compact or query),
                        "$options": "i",
                    },
                }
            }
        },
    ]
    if phone:
        or_clauses.append(
            {
                "members": {
                    "$elemMatch": {
                        "status": "open",
                        "phone": phone,
                    }
                }
            }
        )
        or_clauses.append({"open_phones": phone})
    if nid:
        or_clauses.append({"open_person_id_numbers": nid})
        or_clauses.append(
            {
                "members": {
                    "$elemMatch": {
                        "status": "open",
                        "person_id.number": nid,
                    }
                }
            }
        )
    return {"$or": or_clauses}


def _member_matches_query(member: UnassignedMember, query: str) -> bool:
    q = query.strip().lower()
    if not q:
        return False
    if q in member.first_name.lower() or q in (member.last_name or "").lower():
        return True
    compact = re.sub(r"[\s\-]+", "", q)
    digits = re.sub(r"\D", "", compact)
    if member.phone and digits and digits in re.sub(r"\D", "", member.phone):
        return True
    number = (member.person_id.number if member.person_id else None) or ""
    if number and (compact in number.lower() or (digits and digits in re.sub(r"\D", "", number))):
        return True
    return False


def _identity_keys_match(doc: UnassignedRegistration, query: str) -> bool:
    compact = re.sub(r"[\s\-]+", "", query.strip())
    phone = normalize_phone(compact) if compact else ""
    nid = normalize_national_id(compact) if compact.isdigit() and len(compact) == 13 else ""
    if phone and phone in doc.open_phones:
        return True
    if nid and nid in doc.open_person_id_numbers:
        return True
    return False


def _open_member_hit(member: UnassignedMember) -> OpenMemberHit:
    person_id = None
    if member.person_id is not None:
        person_id = PersonIdOut(
            cardType=member.person_id.cardType,
            number=member.person_id.number,
        )
    return OpenMemberHit(
        reserved_evacuee_id=member.reserved_evacuee_id,
        status="open",
        first_name=member.first_name,
        last_name=member.last_name,
        gender=member.gender,
        phone=member.phone,
        person_id=person_id,
        country=member.country,
        vulnerable_groups=list(member.vulnerable_groups),
        special_needs=list(member.special_needs),
        nickname=member.nickname,
        religion=member.religion,
        emergency_contact=_emergency_out(member),
        photo=member.photo,
        birth_year=member.birth_year,
        age=member.age,
    )


def _open_pet_hit(pet: UnassignedPet) -> OpenPetHit:
    return OpenPetHit(
        pet_id=pet.pet_id or "",
        status="open",
        species=pet.species,
        count=pet.count,
        notes=pet.notes,
        has_cage=pet.has_cage,
        image_url=pet.image_url,
    )


def _pet_response(pet: UnassignedPet) -> PetCreated:
    claimed_at = pet.claimed_at.isoformat() if pet.claimed_at else None
    return PetCreated(
        pet_id=pet.pet_id or "",
        status=pet.effective_status(),
        species=pet.species,
        count=pet.count,
        notes=pet.notes,
        has_cage=pet.has_cage,
        image_url=pet.image_url,
        claimed_shelter_code=pet.claimed_shelter_code,
        claimed_at=claimed_at,
        claimed_by=pet.claimed_by,
    )


def _household_out(household: UnassignedHousehold) -> HouseholdOut:
    return HouseholdOut(
        housing_type=household.housing_type,
        residence_landmark=household.residence_landmark,
        address_no=household.address_no,
        village_no=household.village_no,
        subdistrict=household.subdistrict,
        district=household.district,
        province=household.province,
        postal_code=household.postal_code,
        geo=household.geo,
        label=household.label,
        pets=[_pet_response(p) for p in (household.pets or [])],
    )


def _list_item(doc: UnassignedRegistration) -> UnassignedRegistrationListItem:
    _ensure_pet_ids(doc)
    open_members = [_open_member_hit(m) for m in doc.members if m.status == "open"]
    open_pets = [_open_pet_hit(p) for p in _open_pets(doc)]
    return UnassignedRegistrationListItem(
        id=doc.id,
        reserved_household_id=doc.reserved_household_id,
        registered_via=doc.registered_via,
        status=doc.status,
        created_at=doc.created_at.isoformat(),
        household=_household_out(doc.household),
        open_members=open_members,
        open_member_count=len(open_members),
        open_pets=open_pets,
        open_pet_count=len(open_pets),
    )


def _detail_response(doc: UnassignedRegistration) -> UnassignedRegistrationDetailResponse:
    _ensure_pet_ids(doc)
    return UnassignedRegistrationDetailResponse(
        id=doc.id,
        schema_v=doc.schema_v,
        reserved_household_id=doc.reserved_household_id,
        registered_via=doc.registered_via,
        status=doc.status,
        created_at=doc.created_at.isoformat(),
        household=_household_out(doc.household),
        members=[_member_response(m) for m in doc.members],
    )
