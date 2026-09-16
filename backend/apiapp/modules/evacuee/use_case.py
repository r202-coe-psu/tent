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

#: Staff `current_stay.status` values reported to public search verbatim
#: (CR-080 + CR-112). Includes `arriving` and `room_confirmed` so Zone Arrival
#: Confirmation and Report-in are visible to relatives. Anything outside this
#: set is reported as `unknown` rather than guessed at.
PUBLIC_STAY_STATUSES = frozenset(
    {
        "pre_registered",
        "arriving",
        "active",
        "room_confirmed",
        "temporary_leave",
        "transferred",
        "checked_out",
        "deceased",
        "cancelled",
    }
)


def map_public_status(stay_status: str) -> str:
    return stay_status if stay_status in PUBLIC_STAY_STATUSES else "unknown"


def _extract_shelter_address(shelter: PublicShelter | None) -> str | None:
    if not shelter:
        return None
    raw = shelter.raw_data or {}

    # 1. Structured physical address fields (CR-023: address_no, village_no, etc.)
    address_no = raw.get("address_no")
    if address_no:
        parts = [str(address_no)]
        if raw.get("village_no"):
            v = str(raw["village_no"]).strip()
            parts.append(v if (v.startswith("ม.") or v.startswith("หมู่")) else f"ม.{v}")
        sub = raw.get("subdistrict") or shelter.subdistrict
        if sub:
            s = str(sub).strip()
            parts.append(s if (s.startswith("ต.") or s.startswith("ตำบล")) else f"ต.{s}")
        dist = raw.get("district") or shelter.district
        if dist:
            d = str(dist).strip()
            parts.append(d if (d.startswith("อ.") or d.startswith("อำเภอ")) else f"อ.{d}")
        prov = raw.get("province") or shelter.province
        if prov:
            p = str(prov).strip()
            parts.append(p if (p.startswith("จ.") or p.startswith("จังหวัด")) else f"จ.{p}")
        if raw.get("postal_code"):
            parts.append(str(raw["postal_code"]))
        return " ".join(parts)

    # 2. Physical address from location.address (pin/map address or free text)
    location_doc = raw.get("location") or {}
    loc_address = location_doc.get("address")
    if loc_address and isinstance(loc_address, str) and loc_address.strip():
        return loc_address.strip()

    # 3. Top-level shelter address if present
    if shelter.address and shelter.address.strip():
        return shelter.address.strip()

    # 4. Fallback administrative boundary
    parts = []
    sub = raw.get("subdistrict") or shelter.subdistrict
    if sub:
        s = str(sub).strip()
        parts.append(s if (s.startswith("ต.") or s.startswith("ตำบล")) else f"ต.{s}")
    dist = raw.get("district") or shelter.district
    if dist:
        d = str(dist).strip()
        parts.append(d if (d.startswith("อ.") or d.startswith("อำเภอ")) else f"อ.{d}")
    prov = raw.get("province") or shelter.province
    if prov:
        p = str(prov).strip()
        parts.append(p if (p.startswith("จ.") or p.startswith("จังหวัด")) else f"จ.{p}")
    if parts:
        return " ".join(parts)

    return None


def _resolve_zone_name(shelter: PublicShelter | None, care_zone: str | None) -> str | None:
    if not care_zone:
        return None
    if not shelter or not shelter.raw_data:
        return care_zone
    zones = shelter.raw_data.get("zones") or []
    for z in zones:
        if isinstance(z, dict):
            if z.get("code") == care_zone:
                return z.get("name") or care_zone
            if z.get("name") == care_zone:
                return z.get("name")
    return care_zone


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
        shelters = await self._load_shelters({person.shelter_code for person in persons})

        results = [
            await self._to_result(person, shelters.get(person.shelter_code)) for person in persons
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
            return (
                await PublicPerson.find(
                    PublicPerson.national_id_hash == national_id_hash(parsed.normalized),
                    PublicPerson.search_excluded != True,  # noqa: E712
                )
                .limit(NAME_RESULT_LIMIT)
                .to_list()
            )

        if parsed.kind == SearchQueryKind.PASSPORT:
            return (
                await PublicPerson.find(
                    PublicPerson.passport_hash == passport_hash(parsed.normalized),
                    PublicPerson.search_excluded != True,  # noqa: E712
                )
                .limit(NAME_RESULT_LIMIT)
                .to_list()
            )

        if parsed.kind == SearchQueryKind.PHONE:
            return (
                await PublicPerson.find(
                    PublicPerson.phone_hash == phone_hash(parsed.normalized),
                    PublicPerson.search_excluded != True,  # noqa: E712
                )
                .limit(NAME_RESULT_LIMIT)
                .to_list()
            )

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

    async def _load_shelters(self, codes: set[str]) -> dict[str, PublicShelter]:
        if not codes:
            return {}

        shelters = await PublicShelter.find({"shelter_code": {"$in": list(codes)}}).to_list()
        return {shelter.shelter_code: shelter for shelter in shelters}

    async def _load_family_members(
        self, person: PublicPerson, shelter_name: str
    ) -> list[FamilyMember]:
        if not person.household_id:
            return []

        members = await PublicPerson.find(
            PublicPerson.household_id == person.household_id,
            PublicPerson.shelter_code == person.shelter_code,
            PublicPerson.search_excluded != True,  # noqa: E712
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

    async def _to_result(
        self,
        person: PublicPerson,
        shelter: PublicShelter | None = None,
        shelter_name: str | None = None,
    ) -> SearchResult:
        name = shelter_name or (shelter.name if shelter and shelter.name else person.shelter_code)
        shelter_address = _extract_shelter_address(shelter)
        zone_name = _resolve_zone_name(shelter, person.care_zone)

        return SearchResult(
            name=f"{person.first_name} {person.last_name_masked}",
            status=map_public_status(person.status),
            national_id=person.national_id_masked,
            gender=person.gender,
            shelter_name=name,
            shelter_address=shelter_address,
            origin_address=person.address_masked,
            checked_in_at=person.checked_in_at,
            care_zone=zone_name,
            zone_name=zone_name,
            family_members=await self._load_family_members(person, name),
        )


def get_evacuee_use_case() -> EvacueeUseCase:
    return EvacueeUseCase()
