"""Evacuee public search use case — reads public_persons projection."""

from __future__ import annotations

import logging
import re
from collections.abc import Collection
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pymongo import ASCENDING
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.search_audit import SearchAudit

from ...utils.masking import (
    last_name_hash,
    national_id_hash,
    passport_hash,
    phone_hash,
    sha256_hex,
)
from ...utils.search_query import ParsedSearchQuery, SearchQueryKind, parse_search_query
from ...utils.ulid import new_ulid
from .schemas import (
    ExternalSearchResponse,
    ExternalSearchResult,
    FamilyMember,
    SearchResponse,
    SearchResult,
    ShelterStatus,
)

logger = logging.getLogger(__name__)

NAME_RESULT_LIMIT = 10

#: Staff `current_stay.status` values reported to public search verbatim
#: (CR-080 + CR-112). Includes `arriving` and `room_confirmed` so Zone Arrival
#: Confirmation and Report-in are visible to relatives. Anything outside this
#: set is reported as `unknown` rather than guessed at.
PUBLIC_STAY_STATUSES = frozenset(
    {
        "pre_registered",
        "kiosk_registered",
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


_SHELTER_STATUSES: frozenset[str] = frozenset({"open", "closed", "full", "standby"})


def _shelter_status(shelter: PublicShelter | None) -> ShelterStatus | None:
    """`public_shelters.status` for the response; unknown values are reported as null."""
    if shelter is None or shelter.status not in _SHELTER_STATUSES:
        return None
    return shelter.status  # type: ignore[return-value]


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
    """Partner-facing zone label (`/external/v1/occupants`, EXT-012); never on the public search."""
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
        persons = await self._find_and_audit(raw_query, client_ip=client_ip)
        results = await self.build_results(persons)
        return SearchResponse(results=results, count=len(results), as_of=datetime.now(UTC))

    async def search_external(
        self, raw_query: str, *, client_ip: str = "unknown"
    ) -> ExternalSearchResponse:
        """`/external/v1/occupants`: the public search plus `care_zone` / `zone_name`."""
        persons = await self._find_and_audit(raw_query, client_ip=client_ip)
        results = await self.build_external_results(persons)
        return ExternalSearchResponse(results=results, count=len(results), as_of=datetime.now(UTC))

    async def _find_and_audit(self, raw_query: str, *, client_ip: str) -> list[PublicPerson]:
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

        persons = await self.find_persons(parsed)
        await self._write_search_audit(
            parsed=parsed,
            client_ip=client_ip,
            result_count=len(persons),
        )
        return persons

    async def build_results(
        self, persons: list[PublicPerson], *, include_family: bool = True
    ) -> list[SearchResult]:
        """Masked `SearchResult`s for `persons`, in order.

        `include_family=False` skips the household lookup entirely (EXT-012 never returns
        `family_members`), leaving that field empty.
        """
        shelters = await self._load_shelters({person.shelter_code for person in persons})
        return [
            await self._to_result(
                person, shelters.get(person.shelter_code), include_family=include_family
            )
            for person in persons
        ]

    async def build_external_results(
        self, persons: list[PublicPerson], *, include_family: bool = True
    ) -> list[ExternalSearchResult]:
        """`build_results` plus the resolved zone, for partner endpoints only."""
        shelters = await self._load_shelters({person.shelter_code for person in persons})
        results = []
        for person in persons:
            shelter = shelters.get(person.shelter_code)
            result = await self._to_result(person, shelter, include_family=include_family)
            zone_name = _resolve_zone_name(shelter, person.care_zone)
            results.append(
                ExternalSearchResult(
                    **result.model_dump(), care_zone=zone_name, zone_name=zone_name
                )
            )
        return results

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

    async def find_persons(
        self,
        parsed: ParsedSearchQuery,
        *,
        exclude_statuses: Collection[str] = (),
    ) -> list[PublicPerson]:
        """Find up to `NAME_RESULT_LIMIT` people matching a parsed query (shared finder).

        Every branch applies the same exclusions in the Mongo query *before* the limit —
        `search_excluded` opt-outs plus any `exclude_statuses` — and sorts by
        (`first_name_key`, `_id`) so the people that survive the cap are the same ones every
        time (CR-166 "sort every case", #736). Callers that must hide a status (EXT-012 drops
        `cancelled`) pass it here rather than filtering the capped list afterwards.
        """
        if parsed.kind == SearchQueryKind.NATIONAL_ID:
            match: dict = {"national_id_hash": national_id_hash(parsed.normalized)}
        elif parsed.kind == SearchQueryKind.PASSPORT:
            match = {"passport_hash": passport_hash(parsed.normalized)}
        elif parsed.kind == SearchQueryKind.PHONE:
            match = {"phone_hash": phone_hash(parsed.normalized)}
        else:
            match = self._name_filter(parsed.normalized.split(" "))

        conditions: list[dict] = [match, {"search_excluded": {"$ne": True}}]
        if exclude_statuses:
            conditions.append({"status": {"$nin": list(exclude_statuses)}})

        return (
            await PublicPerson.find(*conditions)
            .sort([("first_name_key", ASCENDING), ("_id", ASCENDING)])
            .limit(NAME_RESULT_LIMIT)
            .to_list()
        )

    @staticmethod
    def _name_filter(words: list[str]) -> dict:
        """Name-search filter (CR-166): first-name prefix AND full surname, both anchored.

        `words` is the normalized query (`parse_search_query`) split on spaces. Only the
        masked surname is stored in plaintext, so a surname is compared as a hash of the
        whole normalized surname — it matches exactly or not at all, which keeps a partial
        surname from turning the endpoint into a browse oracle.

        - one word: it is a prefix of the first name, or it is the whole surname;
        - several words: some split point puts the leading words as a first-name prefix
          and the rest (spaces removed) as the whole surname — every split is tried
          because a first name can have several words ("John Paul Smith").

        The prefix is anchored: "the name starts like this" is what someone half-remembering
        a relative's name needs, an unanchored substring would not be (see CR-099).
        """

        def first_name_prefix(prefix: str) -> dict:
            return {"first_name_key": {"$regex": f"^{re.escape(prefix)}"}}

        if len(words) == 1:
            return {
                "$or": [
                    first_name_prefix(words[0]),
                    {"last_name_hash": last_name_hash(words[0])},
                ]
            }
        return {
            "$or": [
                {
                    **first_name_prefix(" ".join(words[:split])),
                    "last_name_hash": last_name_hash("".join(words[split:])),
                }
                for split in range(1, len(words))
            ]
        }

    async def _load_shelters(self, codes: set[str]) -> dict[str, PublicShelter]:
        if not codes:
            return {}

        shelters = await PublicShelter.find({"shelter_code": {"$in": list(codes)}}).to_list()
        return {shelter.shelter_code: shelter for shelter in shelters}

    async def _load_family_members(
        self,
        person: PublicPerson,
        shelter_name: str,
        shelter_status: ShelterStatus | None,
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
                shelter_status=shelter_status,
            )
            for member in members
            if member.id != person.id
        ]

    async def _to_result(
        self,
        person: PublicPerson,
        shelter: PublicShelter | None = None,
        shelter_name: str | None = None,
        *,
        include_family: bool = True,
    ) -> SearchResult:
        name = shelter_name or (shelter.name if shelter and shelter.name else person.shelter_code)
        shelter_address = _extract_shelter_address(shelter)
        shelter_status = _shelter_status(shelter)

        return SearchResult(
            name=f"{person.first_name} {person.last_name_masked}",
            status=map_public_status(person.status),
            national_id=person.national_id_masked,
            gender=person.gender,
            shelter_name=name,
            shelter_address=shelter_address,
            origin_address=person.address_masked,
            checked_in_at=person.checked_in_at,
            shelter_status=shelter_status,
            family_members=(
                await self._load_family_members(person, name, shelter_status)
                if include_family
                else []
            ),
        )


def get_evacuee_use_case() -> EvacueeUseCase:
    return EvacueeUseCase()
