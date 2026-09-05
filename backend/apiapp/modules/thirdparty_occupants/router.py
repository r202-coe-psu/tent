"""EXT-007 — partner occupant-detail scaffold (partner ODT, ADR 0002 §6).

Not scope-gated at the router level like the other third-party endpoints — the
scope check happens inside the use case so a denied attempt can still be logged
with `location_code`/`purpose` (`require_scope` alone can't see those)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from ...utils.request_meta import client_ip
from ..thirdparty_auth.scopes import ThirdPartyClaims, verify_thirdparty_token
from .schemas import OccupantsEnvelope, OccupantsErrorResponse
from .use_case import ThirdPartyOccupantsUseCase, get_thirdparty_occupants_use_case

router = APIRouter(prefix="/api/thirdparty", tags=["Third-party Occupants"])


@router.get(
    "/locations/{location_code}/occupants",
    response_model=OccupantsEnvelope,
    responses={
        400: {"model": OccupantsErrorResponse},
        403: {"model": OccupantsErrorResponse},
        404: {"model": OccupantsErrorResponse},
    },
)
async def get_location_occupants(
    location_code: str,
    request: Request,
    purpose: str | None = Query(default=None),
    claims: ThirdPartyClaims = Depends(verify_thirdparty_token),  # noqa: B008
    use_case: ThirdPartyOccupantsUseCase = Depends(get_thirdparty_occupants_use_case),  # noqa: B008
) -> OccupantsEnvelope:
    return await use_case.get_occupants(
        location_code=location_code,
        purpose=purpose,
        claims=claims,
        client_ip=client_ip(request),
    )
