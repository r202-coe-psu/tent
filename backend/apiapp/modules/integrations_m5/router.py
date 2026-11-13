"""Internal outbound-integration routes — BFF only (Bearer EXTERNAL_API_SECRET).

Draft CR — referral M5 integration §5. Not exposed through nginx (only `/external/` is).
"""

from __future__ import annotations

import asyncio
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status

from ...core.security import verify_external_secret
from ..integrations_m6.use_case import M6UseCase, get_m6_use_case
from .client import M5CredentialInvalid, M5Error, M5NotConfigured, M5Unavailable
from .schemas import (
    IntegrationStatusResponse,
    M5ActionRequest,
    M5CancelRequest,
    M5FacilitiesResponse,
    M5SyncResponse,
    M5TransferCreateRequest,
    M5TransferCreateResponse,
    M5TransferView,
)
from .use_case import M5UseCase, get_m5_use_case

router = APIRouter(
    prefix="/v1/integrations",
    tags=["Integrations"],
    dependencies=[Depends(verify_external_secret)],
)

_CODE_PATTERN = r"^TRF-\d{8}-\d{4,}$"
_Code = Path(pattern=_CODE_PATTERN, max_length=32)


def _raise(exc: Exception) -> NoReturn:
    """Map M5 client failures to the HTTP contract in CR §5."""
    if isinstance(exc, M5NotConfigured):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "M5_NOT_CONFIGURED", "message": "ระบบส่งต่อผู้ป่วยยังไม่พร้อม"},
        ) from exc
    if isinstance(exc, M5CredentialInvalid):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "M5_CREDENTIAL_INVALID", "message": "ระบบส่งต่อผู้ป่วยยังไม่พร้อม"},
        ) from exc
    if isinstance(exc, M5Unavailable):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "M5_UNAVAILABLE", "message": "เชื่อมต่อระบบส่งต่อผู้ป่วย (M5) ไม่ได้"},
        ) from exc
    if isinstance(exc, M5Error):
        raise HTTPException(
            exc.status, {"code": exc.code, "message": exc.message, **exc.extra}
        ) from exc
    raise exc


_M5_FAILURES = (M5NotConfigured, M5CredentialInvalid, M5Unavailable, M5Error)


@router.get("/status", response_model=IntegrationStatusResponse)
async def integration_status(
    response: Response,
    use_case: M5UseCase = Depends(get_m5_use_case),  # noqa: B008
    m6_use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> IntegrationStatusResponse:
    response.headers["Cache-Control"] = "no-store"
    # Concurrent: the BFF gives this call 3 s, so two slow probes must not add up.
    m5, m6 = await asyncio.gather(use_case.status(), m6_use_case.status())
    return IntegrationStatusResponse(m5=m5, m6=m6)


@router.get("/m5/facilities", response_model=M5FacilitiesResponse)
async def m5_facilities(
    q: str | None = Query(default=None, max_length=100),
    use_case: M5UseCase = Depends(get_m5_use_case),  # noqa: B008
) -> M5FacilitiesResponse:
    try:
        return await use_case.facilities(q)
    except _M5_FAILURES as exc:
        _raise(exc)


@router.post(
    "/m5/transfers",
    response_model=M5TransferCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def m5_create_transfer(
    payload: M5TransferCreateRequest,
    response: Response,
    use_case: M5UseCase = Depends(get_m5_use_case),  # noqa: B008
) -> M5TransferCreateResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        created = await use_case.create_transfer(payload)
    except _M5_FAILURES as exc:
        _raise(exc)
    if created.replayed:
        response.status_code = status.HTTP_200_OK
    return created


@router.get("/m5/transfers/{code}", response_model=M5TransferView)
async def m5_get_transfer(
    response: Response,
    code: str = _Code,
    use_case: M5UseCase = Depends(get_m5_use_case),  # noqa: B008
) -> M5TransferView:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await use_case.get_transfer(code)
    except _M5_FAILURES as exc:
        _raise(exc)


@router.post("/m5/transfers/{code}/start", response_model=M5TransferView)
async def m5_start_transfer(
    payload: M5ActionRequest,
    code: str = _Code,
    use_case: M5UseCase = Depends(get_m5_use_case),  # noqa: B008
) -> M5TransferView:
    try:
        return await use_case.start(code, payload.actor)
    except _M5_FAILURES as exc:
        _raise(exc)


@router.post("/m5/transfers/{code}/cancel", response_model=M5TransferView)
async def m5_cancel_transfer(
    payload: M5CancelRequest,
    code: str = _Code,
    use_case: M5UseCase = Depends(get_m5_use_case),  # noqa: B008
) -> M5TransferView:
    try:
        return await use_case.cancel(code, payload.reason, payload.actor)
    except _M5_FAILURES as exc:
        _raise(exc)


@router.post("/m5/sync", response_model=M5SyncResponse)
async def m5_sync(
    use_case: M5UseCase = Depends(get_m5_use_case),  # noqa: B008
) -> M5SyncResponse:
    """Worker tick (every `M5_SYNC_INTERVAL_S`). FastAPI runs several processes, so it
    never polls M5 on its own."""
    try:
        return await use_case.sync()
    except _M5_FAILURES as exc:
        _raise(exc)
