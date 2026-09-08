"""Admin third-party OAuth2 clients router — protected by EXTERNAL_API_SECRET (EXT-001)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from ...core.security import verify_external_secret
from .schemas import (
    ThirdPartyClientCreateRequest,
    ThirdPartyClientCreateResponse,
    ThirdPartyClientListResponse,
    ThirdPartyClientRevokeResponse,
)
from .use_case import ThirdPartyClientsAdminUseCase, get_thirdparty_clients_admin_use_case

router = APIRouter(
    prefix="/v1/admin/thirdparty-clients",
    tags=["Third-party Clients Admin"],
    dependencies=[Depends(verify_external_secret)],
)


@router.post(
    "",
    response_model=ThirdPartyClientCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_client(
    payload: ThirdPartyClientCreateRequest,
    response: Response,
    use_case: ThirdPartyClientsAdminUseCase = Depends(  # noqa: B008
        get_thirdparty_clients_admin_use_case
    ),
) -> ThirdPartyClientCreateResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.create(payload)


@router.get("", response_model=ThirdPartyClientListResponse)
async def list_clients(
    response: Response,
    use_case: ThirdPartyClientsAdminUseCase = Depends(  # noqa: B008
        get_thirdparty_clients_admin_use_case
    ),
) -> ThirdPartyClientListResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.list_clients()


@router.post("/{client_row_id}/revoke", response_model=ThirdPartyClientRevokeResponse)
async def revoke_client(
    client_row_id: str,
    response: Response,
    use_case: ThirdPartyClientsAdminUseCase = Depends(  # noqa: B008
        get_thirdparty_clients_admin_use_case
    ),
) -> ThirdPartyClientRevokeResponse:
    response.headers["Cache-Control"] = "no-store"
    return await use_case.revoke(client_row_id)
