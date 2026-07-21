"""Evacuee public search use case — reads public_persons projection."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter

from ...utils.masking import national_id_hash, passport_hash, phone_hash
from ...utils.search_query import ParsedSearchQuery, SearchQueryKind, parse_search_query
from .schemas import FamilyMember, SearchResponse, SearchResult

NAME_RESULT_LIMIT = 10

IN_SHELTER_STATUSES = frozenset({"pre_registered", "active", "temporary_leave"})
MOVED_STATUSES = frozenset({"transferred"})
CHECKED_OUT_STATUSES = frozenset({"checked_out", "deceased"})


def map_public_status(stay_status: str) -> str:
    if stay_status in IN_SHELTER_STATUSES:
        return "in_shelter"
    if stay_status in MOVED_STATUSES:
        return "moved"
    if stay_status in CHECKED_OUT_STATUSES:
        return "checked_out"
    return "checked_out"


class EvacueeUseCase:
    async def search(self, raw_query: str) -> SearchResponse:
        parsed = parse_search_query(raw_query)
        if parsed is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "error": {
                        "code": "VALIDATION",
                        "message": "Query is too short or invalid",
                    }
                },
            )

        persons = await self._find_persons(parsed)
        shelter_names = await self._load_shelter_names({person.shelter_code for person in persons})

        results = [
            await self._to_result(
                person, shelter_names.get(person.shelter_code, person.shelter_code)
            )
            for person in persons
        ]

        return SearchResponse(
            results=results,
            count=len(results),
            as_of=datetime.now(UTC),
        )

    async def _find_persons(self, parsed: ParsedSearchQuery) -> list[PublicPerson]:
        if parsed.kind == SearchQueryKind.NATIONAL_ID:
            person = await PublicPerson.find_one(
                PublicPerson.national_id_hash == national_id_hash(parsed.normalized),
                {"search_excluded": {"$ne": True}},
            )
            return [person] if person else []

        if parsed.kind == SearchQueryKind.PASSPORT:
            person = await PublicPerson.find_one(
                PublicPerson.passport_hash == passport_hash(parsed.normalized),
                {"search_excluded": {"$ne": True}},
            )
            return [person] if person else []

        if parsed.kind == SearchQueryKind.PHONE:
            person = await PublicPerson.find_one(
                PublicPerson.phone_hash == phone_hash(parsed.normalized),
                {"search_excluded": {"$ne": True}},
            )
            return [person] if person else []

        return (
            await PublicPerson.find(
                {"$text": {"$search": parsed.normalized}},
                {"search_excluded": {"$ne": True}},
            )
            .limit(NAME_RESULT_LIMIT)
            .to_list()
        )

    async def _load_shelter_names(self, codes: set[str]) -> dict[str, str]:
        if not codes:
            return {}

        shelters = await PublicShelter.find({"shelter_code": {"$in": list(codes)}}).to_list()
        return {shelter.shelter_code: shelter.name for shelter in shelters}

    async def _load_family_members(
        self, person: PublicPerson, shelter_name: str
    ) -> list[FamilyMember]:
        if not person.household_id:
            return []

        members = await PublicPerson.find(
            PublicPerson.household_id == person.household_id,
            PublicPerson.shelter_code == person.shelter_code,
            {"search_excluded": {"$ne": True}},
        ).to_list()

        return [
            FamilyMember(
                name=f"{member.first_name} {member.last_name_masked}",
                status=map_public_status(member.status),
                shelter_name=shelter_name,
            )
            for member in members
            if member.id != person.id
        ]

    async def _to_result(self, person: PublicPerson, shelter_name: str) -> SearchResult:
        return SearchResult(
            name=f"{person.first_name} {person.last_name_masked}",
            status=map_public_status(person.status),
            national_id=person.national_id_masked,
            gender=person.gender,
            shelter_name=shelter_name,
            origin_address=person.address_masked,
            checked_in_at=person.checked_in_at,
            care_zone=person.care_zone,
            family_members=await self._load_family_members(person, shelter_name),
        )


def get_evacuee_use_case() -> EvacueeUseCase:
    return EvacueeUseCase()
