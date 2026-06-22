"""
Auth API router - authentication endpoints
"""

import typing
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    Response,
    Security,
    Cookie,
    HTTPException,
    status,
)
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
    OAuth2PasswordRequestForm,
)

from .use_case import AuthUseCase, get_auth_use_case
from . import schemas
from .schemas import Strategy
from ...core.config import settings


router = APIRouter(prefix="/v1/auth", tags=["Authentication"])


@router.post("/token", summary="Get OAuth2 access token")
async def login_for_access_token(
    form_data: typing.Annotated[OAuth2PasswordRequestForm, Depends()],
    use_case: AuthUseCase = Depends(get_auth_use_case),
) -> schemas.GetAccessTokenResponse:
    """Get access token using username and password."""
    return await use_case.login_for_access_token(form_data)


@router.post("/login", response_model=schemas.Token)
async def login(
    response: Response,
    form_data: schemas.SignIn,
    use_case: AuthUseCase = Depends(get_auth_use_case),
) -> schemas.Token:
    """Login and get access + refresh tokens."""
    token = await use_case.authenticate(form_data)
    if form_data.strategy == Strategy.COOKIES:
        response.set_cookie(
            key="refresh_token",
            value=token.refresh_token,
            httponly=True,
            # Dev: Lax (HTTP Friendly) | Prod: Strict
            samesite="strict" if settings.APP_ENV == "prod" else "lax",
            # Dev: False (HTTP Friendly) | Prod: True
            secure=settings.APP_ENV == "prod",
            # Persist for 30 days
            max_age=settings.REFRESH_TOKEN_EXPIRE_MINUTES * 60,
        )
        # Hide refresh token from the response body
        token.refresh_token = None

    return token


@router.post("/logout", response_model=schemas.Message)
async def logout(
    response: Response,
    use_case: AuthUseCase = Depends(get_auth_use_case),
) -> schemas.Message:
    """Logout and clear refresh token cookie."""
    await use_case.logout()
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        samesite="strict" if settings.APP_ENV == "prod" else "lax",
        secure=settings.APP_ENV == "prod",
    )
    return schemas.Message(detail="Successfully logged out")


@router.get("/refresh_token")
async def refresh_token(
    response: Response,
    refresh_token: Annotated[str | None, Cookie()] = None,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Security(HTTPBearer(auto_error=False))
    ] = None,
    use_case: AuthUseCase = Depends(get_auth_use_case),
) -> schemas.GetAccessTokenResponse:
    """Refresh access token using refresh token."""
    token = refresh_token or (credentials.credentials if credentials else None)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await use_case.refresh_token(token)
