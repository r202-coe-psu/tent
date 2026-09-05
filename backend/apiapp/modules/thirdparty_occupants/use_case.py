"""Use case for EXT-007 occupant-detail scaffold (partner ODT, ADR 0002 §6).

Denied by default: every attempt is logged (granted or not) per PDPA auditability,
`purpose` is mandatory, and no occupant PII is ever returned in this slice — see
CR-109 / ext-spec.md "Out of Scope" (returning real payloads is a later CR, once an
authority has actually approved `occupancy-pii-read` for a specific module).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from ...utils.ulid import new_ulid
from ..thirdparty_auth.scopes import ThirdPartyClaims
from .schemas import OccupantsEnvelope

_REQUIRED_SCOPE = "occupancy-pii-read"
_SCOPE_DENIED_DETAIL = "ต้องได้รับอนุมัติสิทธิ์เป็นรายกรณีก่อนใช้งาน"


def _missing_purpose_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": {"code": "missing_purpose", "message": "purpose is required."}},
    )


def _scope_denied_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error": {
                "code": "insufficient_scope",
                "message": f"scope {_REQUIRED_SCOPE} is required.",
                "detail": _SCOPE_DENIED_DETAIL,
            }
        },
    )


def _location_not_found_error(location_code: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": {
                "code": "location_not_found",
                "message": f"No location with code '{location_code}'",
            }
        },
    )


class ThirdPartyOccupantsUseCase:
    async def _log(
        self,
        *,
        claims: ThirdPartyClaims,
        location_code: str,
        purpose: str | None,
        client_ip: str,
        outcome: str,
        result_count: int = 0,
    ) -> None:
        await ThirdPartyAccessLog(
            id=new_ulid(),
            client_id=claims.client_id,
            module_name=claims.module_name,
            endpoint="EXT-007",
            location_code=location_code,
            purpose=purpose or "",
            ip=client_ip,
            status=outcome,
            result_count=result_count,
            created_at=datetime.now(UTC),
        ).insert()

    async def get_occupants(
        self,
        *,
        location_code: str,
        purpose: str | None,
        claims: ThirdPartyClaims,
        client_ip: str,
    ) -> OccupantsEnvelope:
        if not purpose or not purpose.strip():
            await self._log(
                claims=claims,
                location_code=location_code,
                purpose=purpose,
                client_ip=client_ip,
                outcome="denied_missing_purpose",
            )
            raise _missing_purpose_error()

        if _REQUIRED_SCOPE not in claims.scopes:
            await self._log(
                claims=claims,
                location_code=location_code,
                purpose=purpose,
                client_ip=client_ip,
                outcome="denied_insufficient_scope",
            )
            raise _scope_denied_error()

        shelter = await PublicShelter.find_one(PublicShelter.shelter_code == location_code)
        if shelter is None:
            await self._log(
                claims=claims,
                location_code=location_code,
                purpose=purpose,
                client_ip=client_ip,
                outcome="granted_location_not_found",
            )
            raise _location_not_found_error(location_code)

        # Scope granted and location valid — still no data source wired in this
        # slice (CR-109 Out of Scope). Logged distinctly so a future CR can see
        # real demand for this endpoint before building the real payload.
        await self._log(
            claims=claims,
            location_code=location_code,
            purpose=purpose,
            client_ip=client_ip,
            outcome="granted_no_data_source",
        )
        return OccupantsEnvelope(result=[])


def get_thirdparty_occupants_use_case() -> ThirdPartyOccupantsUseCase:
    return ThirdPartyOccupantsUseCase()
