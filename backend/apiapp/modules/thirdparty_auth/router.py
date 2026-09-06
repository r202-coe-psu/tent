from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ...utils.request_meta import client_ip
from .schemas import TokenErrorResponse, TokenRequest, TokenResponse
from .use_case import ThirdPartyAuthUseCase, get_thirdparty_auth_use_case

router = APIRouter(prefix="/api/auth", tags=["Third-party Auth"])


@router.post(
    "/token-third-party",
    response_model=TokenResponse,
    responses={
        400: {"model": TokenErrorResponse},
        401: {"model": TokenErrorResponse},
    },
)
async def issue_token(
    payload: TokenRequest,
    request: Request,
    use_case: ThirdPartyAuthUseCase = Depends(get_thirdparty_auth_use_case),  # noqa: B008
) -> TokenResponse:
    return await use_case.issue_token(
        grant_type=payload.grant_type,
        client_id=payload.client_id,
        client_secret=payload.client_secret,
        client_ip=client_ip(request),
    )
