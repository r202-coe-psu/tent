"""Unassigned Registration create + staff search/claim/purge (CR-113)."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError, PyMongoError
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedPet,
    UnassignedRegistration,
)

from ...core.staff_session import StaffSession
from ...utils.masking import normalize_national_id, normalize_phone
from ...utils.ulid import new_ulid
from .couch_birth import CouchBirthError, CouchBirthPort, couch_unavailable, get_couch_birth
from .schemas import (
    ClaimedMemberOut,
    MemberCreated,
    MemberInput,
    OpenMemberHit,
    PersonIdInput,
    PersonIdOut,
    UnassignedRegistrationClaimRequest,
    UnassignedRegistrationClaimResponse,
    UnassignedRegistrationCreateRequest,
    UnassignedRegistrationCreateResponse,
    UnassignedRegistrationSearchHit,
    UnassignedRegistrationSearchResponse,
)

# Same shape as staff Anonymous ID (CR-112): ANON- + Crockford ULID.
_ANON_ID_RE = re.compile(r"^ANON-[0-9A-HJKMNP-TV-Z]{26}$", re.IGNORECASE)


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
    )


class UnassignedRegistrationsUseCase:
    def __init__(self, couch_birth: CouchBirthPort | None = None) -> None:
        self._couch_birth = couch_birth or get_couch_birth()

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
            open_members = [
                _open_member_hit(m)
                for m in doc.members
                if m.status == "open" and _member_matches_query(m, query)
            ]
            if not open_members:
                # Doc matched via denormalized keys but no open member text-match —
                # still include all open members when identity keys matched.
                if _identity_keys_match(doc, query):
                    open_members = [_open_member_hit(m) for m in doc.members if m.status == "open"]
            if not open_members:
                continue
            results.append(
                UnassignedRegistrationSearchHit(
                    id=doc.id,
                    reserved_household_id=doc.reserved_household_id,
                    registered_via=doc.registered_via,
                    status=doc.status,
                    created_at=doc.created_at.isoformat(),
                    open_members=open_members,
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
        """Partial/full claim → Couch birth at pre_registered (FR-UR-03/04)."""
        shelter_code = _resolve_claim_shelter(session, payload.shelter_code)
        member_ids = payload.member_ids

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

        by_id = {m.reserved_evacuee_id: m for m in doc.members}
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

        claim_targets = [by_id[mid] for mid in member_ids]
        member_id_set = set(member_ids)
        now = datetime.now(UTC)
        remaining_before_write = [
            m
            for m in doc.members
            if m.status == "open" and m.reserved_evacuee_id not in member_id_set
        ]
        next_open_ids, next_open_phones = _open_identity_keys(remaining_before_write)

        # Atomic gate: only proceed if every target member is still open.
        claimed = await _atomic_mark_claimed(
            registration_id=doc.id,
            member_ids=member_ids,
            shelter_code=shelter_code,
            actor=session.name,
            claimed_at=now,
            open_person_id_numbers=next_open_ids,
            open_phones=next_open_phones,
            document_status="open" if remaining_before_write else "claimed",
        )
        if not claimed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "ALREADY_CLAIMED",
                        "message": "One or more members were already claimed",
                    }
                },
            )

        household_doc = _build_couch_household(
            doc, claim_targets[0], shelter_code, session.name, now
        )
        evacuee_docs = [
            _build_couch_evacuee(
                member, doc.reserved_household_id, shelter_code, session.name, now, doc
            )
            for member in claim_targets
        ]

        try:
            await self._couch_birth.birth(
                shelter_code=shelter_code,
                household_doc=household_doc,
                evacuee_docs=evacuee_docs,
                cookie_header=cookie_header,
            )
        except CouchBirthError as exc:
            await _atomic_revert_claim(
                registration_id=doc.id,
                member_ids=member_ids,
                open_person_id_numbers=list(doc.open_person_id_numbers),
                open_phones=list(doc.open_phones),
                document_status=doc.status,
            )
            raise couch_unavailable(
                "Unassigned Registration claim requires central Couch for Evacuee birth"
            ) from exc

        if not remaining_before_write:
            try:
                refreshed = await UnassignedRegistration.get(registration_id)
                if refreshed is not None:
                    await refreshed.delete()
            except (PyMongoError, ConnectionError, TimeoutError, OSError) as exc:
                raise _mongo_unavailable("claim") from exc
            return UnassignedRegistrationClaimResponse(
                id=None,
                deleted=True,
                shelter_code=shelter_code,
                household_id=doc.reserved_household_id,
                evacuee_ids=member_ids,
                claimed=[
                    ClaimedMemberOut(
                        reserved_evacuee_id=m.reserved_evacuee_id,
                        first_name=m.first_name,
                        last_name=m.last_name,
                    )
                    for m in claim_targets
                ],
                remaining_open=[],
            )

        return UnassignedRegistrationClaimResponse(
            id=doc.id,
            deleted=False,
            shelter_code=shelter_code,
            household_id=doc.reserved_household_id,
            evacuee_ids=member_ids,
            claimed=[
                ClaimedMemberOut(
                    reserved_evacuee_id=m.reserved_evacuee_id,
                    first_name=m.first_name,
                    last_name=m.last_name,
                )
                for m in claim_targets
            ],
            remaining_open=[_open_member_hit(m) for m in remaining_before_write],
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


async def _atomic_mark_claimed(
    *,
    registration_id: str,
    member_ids: list[str],
    shelter_code: str,
    actor: str,
    claimed_at: datetime,
    open_person_id_numbers: list[str],
    open_phones: list[str],
    document_status: str,
) -> bool:
    collection = UnassignedRegistration.get_motor_collection()
    result = await collection.update_one(
        {
            "_id": registration_id,
            "$and": [
                {
                    "members": {
                        "$elemMatch": {
                            "reserved_evacuee_id": mid,
                            "status": "open",
                        }
                    }
                }
                for mid in member_ids
            ],
        },
        {
            "$set": {
                "members.$[m].status": "claimed",
                "members.$[m].claimed_shelter_code": shelter_code,
                "members.$[m].claimed_by": actor,
                "members.$[m].claimed_at": claimed_at,
                "open_person_id_numbers": open_person_id_numbers,
                "open_phones": open_phones,
                "status": document_status,
            }
        },
        array_filters=[
            {
                "m.reserved_evacuee_id": {"$in": member_ids},
                "m.status": "open",
            }
        ],
    )
    return result.modified_count == 1


async def _atomic_revert_claim(
    *,
    registration_id: str,
    member_ids: list[str],
    open_person_id_numbers: list[str],
    open_phones: list[str],
    document_status: str,
) -> None:
    collection = UnassignedRegistration.get_motor_collection()
    await collection.update_one(
        {"_id": registration_id},
        {
            "$set": {
                "members.$[m].status": "open",
                "members.$[m].claimed_shelter_code": None,
                "members.$[m].claimed_by": None,
                "members.$[m].claimed_at": None,
                "open_person_id_numbers": open_person_id_numbers,
                "open_phones": open_phones,
                "status": document_status,
            }
        },
        array_filters=[
            {
                "m.reserved_evacuee_id": {"$in": member_ids},
                "m.status": "claimed",
            }
        ],
    )


def _iso(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _household_label(doc: UnassignedRegistration, head: UnassignedMember) -> str:
    if doc.household.label and doc.household.label.strip():
        return doc.household.label.strip()
    joined = f"{head.first_name} {head.last_name}".strip()
    return f"ครอบครัว{joined}" if joined else "ครอบครัวผู้ลงทะเบียนล่วงหน้า"


def _build_couch_household(
    doc: UnassignedRegistration,
    head: UnassignedMember,
    shelter_code: str,
    actor: str,
    now: datetime,
) -> dict:
    hh = doc.household
    ts = _iso(now)
    return {
        "_id": doc.reserved_household_id,
        "type": "household",
        "schema_v": 5,
        "shelter_code": shelter_code,
        "created_at": ts,
        "updated_at": ts,
        "created_by": actor,
        "label": _household_label(doc, head),
        "head_evacuee_id": head.reserved_evacuee_id,
        "status": "pre_registered",
        "checkout_destination": None,
        "municipality_zone": None,
        "community": None,
        "pets": [
            {
                "species": pet.species,
                "count": pet.count,
                **({"notes": pet.notes} if pet.notes else {}),
                "has_cage": pet.has_cage,
            }
            for pet in hh.pets
        ],
        "assets": None,
        "vehicles": [],
        "housing_type": hh.housing_type,
        "residence_landmark": hh.residence_landmark,
        "address_no": hh.address_no,
        "village_no": hh.village_no,
        "subdistrict": hh.subdistrict,
        "district": hh.district,
        "province": hh.province,
        "postal_code": hh.postal_code,
    }


_RELIGION_ALLOWED = frozenset({"buddhist", "muslim", "christian", "other", "unknown"})


def _build_couch_evacuee(
    member: UnassignedMember,
    household_id: str,
    shelter_code: str,
    actor: str,
    now: datetime,
    doc: UnassignedRegistration,
) -> dict:
    ts = _iso(now)
    person_id = None
    if member.person_id is not None:
        person_id = {
            "cardType": member.person_id.cardType,
            "number": member.person_id.number,
        }
    registered_via = doc.registered_via if doc.registered_via in {"web", "staff"} else "web"
    body: dict = {
        "_id": member.reserved_evacuee_id,
        "type": "evacuee",
        "schema_v": 10,
        "shelter_code": shelter_code,
        "created_at": ts,
        "updated_at": ts,
        "created_by": actor,
        "first_name": member.first_name,
        "last_name": member.last_name or "",
        "gender": member.gender,
        "phone": member.phone,
        "country": member.country or "THAILAND",
        "vulnerable_groups": list(member.vulnerable_groups),
        "special_needs": list(member.special_needs),
        "household_id": household_id,
        "current_stay": {
            "status": "pre_registered",
            "zone": None,
            "since": ts,
        },
        "privacy": {"search_excluded": False},
        "registered_via": registered_via,
    }
    if person_id is not None:
        body["person_id"] = person_id
    if member.birth_year is not None:
        body["birth_year"] = member.birth_year
    if member.age is not None:
        body["age"] = member.age
    if member.nickname:
        body["nickname"] = member.nickname
    if member.religion and member.religion in _RELIGION_ALLOWED:
        body["religion"] = member.religion
    return body


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
    """Mongo filter: documents with at least one open member matching q."""
    compact = re.sub(r"[\s\-]+", "", query)
    phone = normalize_phone(compact) if compact else ""
    nid = normalize_national_id(compact) if compact.isdigit() and len(compact) == 13 else ""
    or_clauses: list[dict] = [
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
    )
