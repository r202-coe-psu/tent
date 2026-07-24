"""Needs public list API router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from .schemas import NeedsListResponse
from .use_case import NeedsUseCase, get_needs_use_case

router = APIRouter(prefix="/public/v1/needs", tags=["Needs"])

CACHE_CONTROL = "public, max-age=600"


@router.get("", response_model=NeedsListResponse)
async def list_needs(
    response: Response,
    use_case: NeedsUseCase = Depends(get_needs_use_case),  # noqa: B008
) -> NeedsListResponse:
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await use_case.list_needs()
