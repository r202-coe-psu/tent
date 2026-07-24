"""Evacuee public search API router."""

from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ...utils.request_meta import client_ip
from .schemas import ApiErrorResponse, SearchRequest, SearchResponse
from .use_case import EvacueeUseCase, get_evacuee_use_case

router = APIRouter(prefix="/public/v1/family-search", tags=["Family Search"])

RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 30
_request_log: dict[str, list[float]] = defaultdict(list)
_rate_limit_lock = Lock()


def _check_rate_limit(ip: str) -> None:
    """In-process sliding window — not shared across replicas (see ``client_ip``)."""
    now = time.time()
    with _rate_limit_lock:
        timestamps = [ts for ts in _request_log[ip] if now - ts < RATE_LIMIT_WINDOW_SECONDS]
        if len(timestamps) >= RATE_LIMIT_MAX_REQUESTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Too many search requests. Please try again later.",
                    }
                },
            )
        timestamps.append(now)
        _request_log[ip] = timestamps


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
    _check_rate_limit(ip)
    response.headers["Cache-Control"] = "no-store"
    return await use_case.search(payload.search, client_ip=ip)
