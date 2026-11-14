"""Internal M6 central-warehouse routes — BFF only (Bearer EXTERNAL_API_SECRET).

Draft CR — central warehouse M6 §6. Not exposed through nginx (only `/external/` is).
The shared `GET /v1/integrations/status` lives in `integrations_m5/router.py`.
"""

from __future__ import annotations

from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status

from ...core.security import verify_external_secret
from .client import M6CredentialInvalid, M6Error, M6NotConfigured, M6Unavailable
from .schemas import (
    M6CancelRequest,
    M6CatalogResponse,
    M6StockResponse,
    M6SyncResponse,
    M6WarehousesResponse,
    M6WithdrawalCreateRequest,
    M6WithdrawalListResponse,
    M6WithdrawalView,
)
from .use_case import M6UseCase, get_m6_use_case

router = APIRouter(
    prefix="/v1/integrations",
    tags=["Integrations"],
    dependencies=[Depends(verify_external_secret)],
)

_CODE_PATTERN = r"^[A-Za-z0-9._-]{1,64}$"
_Code = Annotated[str, Path(pattern=_CODE_PATTERN)]
_NOT_READY = "ระบบคลังกลางยังไม่พร้อม"


def _raise(exc: Exception) -> NoReturn:
    """Map M6 client failures to the HTTP contract in CR §6."""
    if isinstance(exc, M6NotConfigured):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "M6_NOT_CONFIGURED", "message": _NOT_READY},
        ) from exc
    if isinstance(exc, M6CredentialInvalid):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "M6_CREDENTIAL_INVALID", "message": _NOT_READY},
        ) from exc
    if isinstance(exc, M6Unavailable):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "M6_UNAVAILABLE", "message": "เชื่อมต่อระบบคลังกลาง (M6) ไม่ได้"},
        ) from exc
    if isinstance(exc, M6Error):
        raise HTTPException(
            exc.status, {"code": exc.code, "message": exc.message, **exc.extra}
        ) from exc
    raise exc


_M6_FAILURES = (M6NotConfigured, M6CredentialInvalid, M6Unavailable, M6Error)


@router.get("/m6/warehouses", response_model=M6WarehousesResponse)
async def m6_warehouses(
    use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> M6WarehousesResponse:
    try:
        return await use_case.warehouses()
    except _M6_FAILURES as exc:
        _raise(exc)


@router.get("/m6/warehouses/{code}/stock", response_model=M6StockResponse)
async def m6_stock(
    code: _Code,
    type_code: str | None = Query(default=None, max_length=32),
    search: str | None = Query(default=None, max_length=100),
    use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> M6StockResponse:
    try:
        return await use_case.stock(code, type_code, search)
    except _M6_FAILURES as exc:
        _raise(exc)


@router.get("/m6/catalog/search", response_model=M6CatalogResponse)
async def m6_catalog_search(
    q: str | None = Query(default=None, max_length=100),
    type_code: str | None = Query(default=None, max_length=32),
    warehouse_code: str | None = Query(default=None, max_length=64),
    cursor: str | None = Query(default=None, max_length=256),
    limit: int | None = Query(default=None, ge=1, le=100),
    use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> M6CatalogResponse:
    try:
        return await use_case.catalog_search(q, type_code, warehouse_code, cursor, limit)
    except _M6_FAILURES as exc:
        _raise(exc)


@router.post(
    "/m6/withdrawals",
    response_model=M6WithdrawalView,
    status_code=status.HTTP_201_CREATED,
)
async def m6_create_withdrawal(
    payload: M6WithdrawalCreateRequest,
    response: Response,
    use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> M6WithdrawalView:
    response.headers["Cache-Control"] = "no-store"
    try:
        created, replayed = await use_case.create(payload)
    except _M6_FAILURES as exc:
        _raise(exc)
    if replayed:
        response.status_code = status.HTTP_200_OK
    return created


@router.get("/m6/withdrawals", response_model=M6WithdrawalListResponse)
async def m6_list_withdrawals(
    response: Response,
    shelter_code: str = Query(min_length=1),
    status_filter: str | None = Query(default=None, alias="status", max_length=200),
    use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> M6WithdrawalListResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.list_withdrawals(shelter_code, status_filter)


@router.get("/m6/withdrawals/{request_code}", response_model=M6WithdrawalView)
async def m6_get_withdrawal(
    response: Response,
    request_code: _Code,
    shelter_code: str = Query(min_length=1),
    use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> M6WithdrawalView:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await use_case.get(request_code, shelter_code)
    except _M6_FAILURES as exc:
        _raise(exc)


@router.post("/m6/withdrawals/{request_code}/cancel", response_model=M6WithdrawalView)
async def m6_cancel_withdrawal(
    payload: M6CancelRequest,
    response: Response,
    request_code: _Code,
    use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> M6WithdrawalView:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await use_case.cancel(request_code, payload)
    except _M6_FAILURES as exc:
        _raise(exc)


@router.post("/m6/sync", response_model=M6SyncResponse)
async def m6_sync(
    use_case: M6UseCase = Depends(get_m6_use_case),  # noqa: B008
) -> M6SyncResponse:
    """Worker tick (every `M6_SYNC_INTERVAL_S`). FastAPI runs several processes, so it
    never polls M6 on its own."""
    try:
        return await use_case.sync()
    except _M6_FAILURES as exc:
        _raise(exc)
