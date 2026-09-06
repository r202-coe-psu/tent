"""EXT-006 — partner cross-location summary endpoint (partner ODT)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..thirdparty_auth.scopes import ThirdPartyClaims, require_scope
from .schemas import SummaryEnvelope
from .use_case import ThirdPartySummaryUseCase, get_thirdparty_summary_use_case

router = APIRouter(prefix="/api/thirdparty", tags=["Third-party Summary"])


@router.get("/summary", response_model=SummaryEnvelope)
async def get_summary(
    claims: ThirdPartyClaims = Depends(require_scope("location-read")),  # noqa: B008
    use_case: ThirdPartySummaryUseCase = Depends(get_thirdparty_summary_use_case),  # noqa: B008
) -> SummaryEnvelope:
    return await use_case.get_summary(include_occupancy="occupancy-read" in claims.scopes)
