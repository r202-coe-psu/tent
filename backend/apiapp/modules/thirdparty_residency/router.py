"""EXT-011 — partner shelter-residency lookup by national ID (M2, CR-154).

Not scope-gated at the router level — the scope check happens inside the use case
so a denied attempt can still be logged with its `purpose` (same as EXT-007)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from ...utils.request_meta import client_ip
from ..thirdparty_auth.scopes import ThirdPartyClaims, verify_thirdparty_token
from .schemas import ResidencyEnvelope, ResidencyErrorResponse
from .use_case import ThirdPartyResidencyUseCase, get_thirdparty_residency_use_case

router = APIRouter(prefix="/external", tags=["External"])


@router.get(
    "/persons/shelter-residency",
    response_model=ResidencyEnvelope,
    responses={
        400: {"model": ResidencyErrorResponse},
        401: {"model": ResidencyErrorResponse},
        403: {"model": ResidencyErrorResponse},
        404: {"model": ResidencyErrorResponse},
        422: {"model": ResidencyErrorResponse},
    },
)
async def get_person_shelter_residency(
    request: Request,
    cid: str | None = Query(default=None, description="เลขประจำตัวประชาชน 13 หลัก"),
    purpose: str | None = Query(default=None, description="วัตถุประสงค์การเรียกดู (บังคับ)"),
    claims: ThirdPartyClaims = Depends(verify_thirdparty_token),  # noqa: B008
    use_case: ThirdPartyResidencyUseCase = Depends(get_thirdparty_residency_use_case),  # noqa: B008
) -> ResidencyEnvelope:
    return await use_case.get_residency(
        cid=cid, purpose=purpose, claims=claims, client_ip=client_ip(request)
    )
