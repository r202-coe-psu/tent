"""Use case for EXT-012 partner person search (#736, CR-154 / CR-166 / CR-099 / CR-176).

Same order of checks as EXT-007 / EXT-011 (ADR 0002 §6): `purpose` → scope → validation →
query. The scope is checked here (not on the router) so denied attempts are still logged.

The search rules and masking are the public ones (`EvacueeUseCase`); on top of them EXT-012
drops `cancelled` people in the Mongo query (before the 10-row cap), returns no
`family_members`, and writes only a `ThirdPartyAccessLog` row — never the query text, and never
a `search_audits` document.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from ...utils.search_query import parse_search_query
from ...utils.ulid import new_ulid
from ..evacuee.use_case import EvacueeUseCase
from ..thirdparty_auth.scopes import ThirdPartyClaims
from .schemas import PersonSearchEnvelope, PersonSearchItem

ENDPOINT = "EXT-012"
_REQUIRED_SCOPE = "occupant-search"
#: Hidden from partners — a cancelled booking is not a person on site (CR-176, #736 decision 3).
_EXCLUDED_STATUSES = ("cancelled",)
#: Same cap the public search form accepts (`SearchRequest.search`).
_MAX_QUERY_LENGTH = 200
_BANGKOK_TZ = ZoneInfo("Asia/Bangkok")


def _to_bangkok_iso(value: datetime | None) -> str | None:
    """ISO 8601 with an explicit +07:00 offset, like EXT-008–011 (Mongo hands back naive UTC)."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(_BANGKOK_TZ).isoformat()


def _resolve_zone_name(shelter: PublicShelter | None, care_zone: str | None) -> str | None:
    """EXT-012 still reports the zone; CR-183 FR-18 drops it from the occupants search only."""
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


def _error(status_code: int, code: str, message: str) -> HTTPException:
    # Errors are personal-data adjacent too (they answer "was this search allowed"): never cache.
    return HTTPException(
        status_code=status_code,
        detail={"error": {"code": code, "message": message}},
        headers={"Cache-Control": "no-store"},
    )


class ThirdPartyPersonSearchUseCase:
    def __init__(self, evacuee: EvacueeUseCase | None = None) -> None:
        self._evacuee = evacuee or EvacueeUseCase()

    async def _log(
        self,
        *,
        claims: ThirdPartyClaims,
        purpose: str | None,
        client_ip: str,
        outcome: str,
        result_count: int = 0,
    ) -> None:
        # No query / CID / name here: the log is evidence of *who searched*, not *for whom*.
        await ThirdPartyAccessLog(
            id=new_ulid(),
            client_id=claims.client_id,
            module_name=claims.module_name,
            endpoint=ENDPOINT,
            location_code="",
            purpose=purpose or "",
            ip=client_ip,
            status=outcome,
            result_count=result_count,
            created_at=datetime.now(UTC),
        ).insert()

    async def search(
        self,
        *,
        search: object,
        purpose: str | None,
        claims: ThirdPartyClaims,
        client_ip: str,
    ) -> PersonSearchEnvelope:
        if not purpose or not purpose.strip():
            await self._log(
                claims=claims,
                purpose=purpose,
                client_ip=client_ip,
                outcome="denied_missing_purpose",
            )
            raise _error(status.HTTP_400_BAD_REQUEST, "missing_purpose", "purpose is required.")

        if _REQUIRED_SCOPE not in claims.scopes:
            await self._log(
                claims=claims,
                purpose=purpose,
                client_ip=client_ip,
                outcome="denied_insufficient_scope",
            )
            raise _error(
                status.HTTP_403_FORBIDDEN,
                "insufficient_scope",
                f"scope '{_REQUIRED_SCOPE}' is required",
            )

        parsed = (
            parse_search_query(search)
            if isinstance(search, str) and len(search) <= _MAX_QUERY_LENGTH
            else None
        )
        if parsed is None:
            await self._log(
                claims=claims,
                purpose=purpose,
                client_ip=client_ip,
                outcome="denied_validation_error",
            )
            raise _error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "validation_error",
                "search is too short or invalid.",
            )

        persons = await self._evacuee.find_persons(parsed, exclude_statuses=_EXCLUDED_STATUSES)
        # No household lookup (#736 decision 4); `family_members` is dropped from the item.
        results = await self._evacuee.build_results(persons, include_family=False)
        codes = list({person.shelter_code for person in persons})
        shelters = {
            shelter.shelter_code: shelter
            for shelter in await PublicShelter.find({"shelter_code": {"$in": codes}}).to_list()
        }
        items = []
        for person, r in zip(persons, results, strict=True):
            zone_name = _resolve_zone_name(shelters.get(person.shelter_code), person.care_zone)
            items.append(
                PersonSearchItem(
                    **r.model_dump(exclude={"family_members", "checked_in_at"}),
                    checked_in_at=_to_bangkok_iso(r.checked_in_at),
                    care_zone=zone_name,
                    zone_name=zone_name,
                )
            )

        await self._log(
            claims=claims,
            purpose=purpose,
            client_ip=client_ip,
            outcome="granted",
            result_count=len(items),
        )
        return PersonSearchEnvelope(result=items)


def get_thirdparty_person_search_use_case() -> ThirdPartyPersonSearchUseCase:
    return ThirdPartyPersonSearchUseCase()
