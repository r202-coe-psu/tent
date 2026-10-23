"""Evacuee public search API router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from ...core.security import verify_external_secret
from ...utils.request_meta import client_ip
from .schemas import ApiErrorResponse, SearchRequest, SearchResponse
from .use_case import EvacueeUseCase, get_evacuee_use_case

router = APIRouter(
    prefix="/public/v1/occupants",
    tags=["Occupants"],
    dependencies=[Depends(verify_external_secret)],
)


@router.post(
    "",
    response_model=SearchResponse,
    responses={
        429: {"model": ApiErrorResponse},
        422: {"model": ApiErrorResponse},
    },
)
async def search_evacuees(
    payload: SearchRequest,
    request: Request,
    response: Response,
    use_case: EvacueeUseCase = Depends(get_evacuee_use_case),  # noqa: B008
) -> SearchResponse:
    """Search evacuees in the public read model (masked, no PII leakage)."""
    ip = client_ip(request)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.search(payload.search, client_ip=ip)
