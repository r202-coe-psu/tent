"""Admin API keys router — protected by EXTERNAL_API_SECRET (CR-062)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from ...core.security import verify_external_secret
from .schemas import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyListResponse,
    ApiKeyRevokeResponse,
)
from .use_case import ApiKeysUseCase, get_api_keys_use_case

router = APIRouter(
    prefix="/v1/admin/api-keys",
    tags=["API Keys"],
    dependencies=[Depends(verify_external_secret)],
)


@router.post(
    "",
    response_model=ApiKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_key(
    payload: ApiKeyCreateRequest,
    response: Response,
    use_case: ApiKeysUseCase = Depends(get_api_keys_use_case),  # noqa: B008
) -> ApiKeyCreateResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.create(payload)


@router.get("", response_model=ApiKeyListResponse)
async def list_api_keys(
    response: Response,
    use_case: ApiKeysUseCase = Depends(get_api_keys_use_case),  # noqa: B008
) -> ApiKeyListResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.list_keys()


@router.post("/{key_id}/revoke", response_model=ApiKeyRevokeResponse)
async def revoke_api_key(
    key_id: str,
    response: Response,
    use_case: ApiKeysUseCase = Depends(get_api_keys_use_case),  # noqa: B008
) -> ApiKeyRevokeResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.revoke(key_id)
