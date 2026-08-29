"""Public transparency aggregate API — Mongo read models only."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from ...core.security import verify_external_secret
from .schemas import TransparencySummaryResponse
from .use_case import TransparencyUseCase, get_transparency_use_case

router = APIRouter(
    prefix="/public/v1/transparency",
    tags=["Transparency"],
    dependencies=[Depends(verify_external_secret)],
)

CACHE_CONTROL = "public, max-age=60"


@router.get("/summary", response_model=TransparencySummaryResponse)
async def get_transparency_summary(
    response: Response,
    use_case: TransparencyUseCase = Depends(get_transparency_use_case),  # noqa: B008
) -> TransparencySummaryResponse:
    """System-wide public metrics from public_shelters + public_persons."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await use_case.get_summary()
