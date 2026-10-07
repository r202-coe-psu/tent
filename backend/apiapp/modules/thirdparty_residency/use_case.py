"""Use case for EXT-011 shelter-residency lookup (M2, CR-154 FR-40..45).

Follows the EXT-007 pattern (ADR 0002 §6): `purpose` is mandatory, the scope is
checked here (not on the router) so denied attempts are still logged, and every
attempt lands in `third_party_access_logs` — never with the CID.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from ...utils.masking import national_id_hash
from ...utils.ulid import new_ulid
from ..thirdparty_auth.scopes import ThirdPartyClaims
from .residency import PRESENT_RESIDENCY_STATUSES, map_shelter_residency
from .schemas import ResidencyEnvelope, ResidencyItem

ENDPOINT = "EXT-011"
_REQUIRED_SCOPE = "residency-read"
_BANGKOK_TZ = ZoneInfo("Asia/Bangkok")


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": {"code": code, "message": message}}
    )


def _pick_record(people: list[PublicPerson]) -> PublicPerson | None:
    """FR-43 — Present stays win; otherwise the most recently updated record."""
    if not people:
        return None
    present = [p for p in people if p.status in PRESENT_RESIDENCY_STATUSES]
    pool = present or people
    return max(pool, key=lambda p: p.updated_at or datetime.min.replace(tzinfo=UTC))


def _to_bangkok_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(_BANGKOK_TZ).isoformat()


class ThirdPartyResidencyUseCase:
    async def _log(
        self,
        *,
        claims: ThirdPartyClaims,
        purpose: str | None,
        client_ip: str,
        outcome: str,
        location_code: str = "",
        result_count: int = 0,
    ) -> None:
        await ThirdPartyAccessLog(
            id=new_ulid(),
            client_id=claims.client_id,
            module_name=claims.module_name,
            endpoint=ENDPOINT,
            location_code=location_code,
            purpose=purpose or "",
            ip=client_ip,
            status=outcome,
            result_count=result_count,
            created_at=datetime.now(UTC),
        ).insert()

    async def get_residency(
        self,
        *,
        cid: str | None,
        purpose: str | None,
        claims: ThirdPartyClaims,
        client_ip: str,
    ) -> ResidencyEnvelope:
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

        cleaned = (cid or "").strip()
        if not cleaned.isdigit() or len(cleaned) != 13:
            await self._log(
                claims=claims,
                purpose=purpose,
                client_ip=client_ip,
                outcome="denied_validation_error",
            )
            raise _error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "validation_error",
                "cid must be 13 digits.",
            )

        people = await PublicPerson.find(
            PublicPerson.national_id_hash == national_id_hash(cleaned)
        ).to_list()
        person = _pick_record(people)
        if person is None or person.checked_in_at is None or person.status == "pre_registered":
            await self._log(
                claims=claims,
                purpose=purpose,
                client_ip=client_ip,
                outcome="denied_residency_not_found",
                location_code=person.shelter_code if person else "",
            )
            raise _error(
                status.HTTP_404_NOT_FOUND,
                "residency_not_found",
                "No shelter residency found for this cid.",
            )

        residency_status, stay_status, in_zone = map_shelter_residency(person.status)
        shelter = await PublicShelter.find_one(PublicShelter.shelter_code == person.shelter_code)

        await self._log(
            claims=claims,
            purpose=purpose,
            client_ip=client_ip,
            outcome="granted",
            location_code=person.shelter_code,
            result_count=1,
        )
        return ResidencyEnvelope(
            result=ResidencyItem(
                location_code=person.shelter_code,
                name_th=shelter.name if shelter else person.shelter_code,
                checkin_datetime=_to_bangkok_iso(person.checked_in_at),
                residency_status=residency_status,
                stay_status=stay_status,
                in_zone=in_zone,
            )
        )


def get_thirdparty_residency_use_case() -> ThirdPartyResidencyUseCase:
    return ThirdPartyResidencyUseCase()
