"""Evacuee public search use case — reads public_persons projection."""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from fastapi import HTTPException, status
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.search_audit import SearchAudit

from ...utils.masking import national_id_hash, passport_hash, phone_hash, sha256_hex
from ...utils.search_query import ParsedSearchQuery, SearchQueryKind, parse_search_query
from ...utils.ulid import new_ulid
from .schemas import FamilyMember, SearchResponse, SearchResult

logger = logging.getLogger(__name__)

NAME_RESULT_LIMIT = 10

#: The seven `current_stay.status` values of the staff data model, reported to
#: the public search verbatim since CR-080. Before that they were collapsed into
#: `in_shelter` / `moved` / `checked_out` (FS-2, CR-005), which answered the one
#: question this endpoint exists for incorrectly: a person who reserved a place
#: through the public booking flow (CR-070) but never arrived is
#: `pre_registered`, and the old mapping displayed them as safely in the shelter.
#: Anything outside this set is reported as `unknown` rather than guessed at, so
#: a projection emitting a status the API has not been taught about cannot be
#: silently rendered as some other outcome.
PUBLIC_STAY_STATUSES = frozenset(
    {
        "pre_registered",
        "active",
        "temporary_leave",
        "transferred",
        "checked_out",
        "deceased",
        "cancelled",
    }
)


def map_public_status(stay_status: str) -> str:
    return stay_status if stay_status in PUBLIC_STAY_STATUSES else "unknown"


class EvacueeUseCase:
    async def search(self, raw_query: str, *, client_ip: str = "unknown") -> SearchResponse:
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

        await self._write_search_audit(
            parsed=parsed,
            client_ip=client_ip,
            result_count=len(results),
        )

        return SearchResponse(
            results=results,
            count=len(results),
            as_of=datetime.now(UTC),
        )

    async def _write_search_audit(
        self,
        *,
        parsed: ParsedSearchQuery,
        client_ip: str,
        result_count: int,
    ) -> None:
        """Append-only audit buffer — never store raw query or IP (hashes only)."""
        try:
            await SearchAudit(
                id=f"search_audit:{new_ulid()}",
                query_kind=parsed.kind.value,
                query_hash=sha256_hex(parsed.normalized),
                ip_hash=sha256_hex(client_ip),
                result_count=result_count,
                occurred_at=datetime.now(UTC),
                synced_to_couch=False,
            ).insert()
        except Exception:
            # Search availability > audit durability; inbound/ops can alert on gaps.
            logger.exception("Failed to write search_audit for kind=%s", parsed.kind.value)

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

        return await self._find_by_name(parsed.normalized)

    async def _find_by_name(self, name: str) -> list[PublicPerson]:
        """Name search: whole-word text index first, then an anchored prefix match.

        The text index alone cannot answer a partial Thai name. MongoDB tokenizes
        `$text` on whitespace and punctuation and matches whole terms, and Thai is
        not one of its supported text-search languages — Thai script also has no
        spaces between words, so a name like "สักก์ธนัชญ์" is one indivisible
        token. Searching "สัก" scored zero hits against three matching records
        until this fallback existed; a relative had to type the name exactly.

        The fallback is deliberately anchored (`^`): "the name starts like this"
        is what someone half-remembering a relative's name needs, whereas an
        unanchored substring would turn the endpoint into a browse-everyone
        oracle. `parse_search_query` already rejects queries under 3 characters,
        the per-IP limiter throttles repeats, and the result cap still applies.

        Runs only when the text search comes back empty, so an exact-name query
        still costs a single round trip.
        """
        exact = (
            await PublicPerson.find(
                {"$text": {"$search": name}},
                {"search_excluded": {"$ne": True}},
            )
            .limit(NAME_RESULT_LIMIT)
            .to_list()
        )
        if exact:
            return exact

        prefix = f"^{re.escape(name)}"
        return (
            await PublicPerson.find(
                {
                    "$or": [
                        {"first_name": {"$regex": prefix}},
                        {"last_name_masked": {"$regex": prefix}},
                    ]
                },
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
