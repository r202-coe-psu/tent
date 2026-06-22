"""
Auth use case - handles authentication logic
"""

import datetime

from fastapi import HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from ..user.model import User
from ...core import security
from ...core.config import settings
from . import schemas


class AuthUseCase:
    """Authentication use case"""

    async def login_for_access_token(
        self,
        form_data: OAuth2PasswordRequestForm,
    ) -> schemas.GetAccessTokenResponse:
        """Get access token (simple OAuth2 flow)"""
        user = await User.find_one({"username": form_data.username, "is_active": True})

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )

        access_token_expires = datetime.timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
        access_token = security.jwt_handler.create_access_token(
            data={"sub": str(user.id)}, expires_delta=access_token_expires
        )
        return schemas.GetAccessTokenResponse(
            access_token=access_token, token_type="bearer"
        )

    async def authenticate(
        self,
        form_data: schemas.SignIn,
    ) -> schemas.Token:
        """Full authentication with access + refresh tokens"""
        user = await User.find_one({"username": form_data.username, "is_active": True})

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
            )

        if not user.verify_password(form_data.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
            )

        # Update last login
        user.last_login_date = datetime.datetime.now()
        await user.save()

        # Generate tokens
        access_token_expires = datetime.timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
        refresh_token_expires = datetime.timedelta(
            minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES
        )

        return schemas.Token(
            access_token=security.jwt_handler.create_access_token(
                data={"sub": str(user.id), "token_type": "access"},
                expires_delta=access_token_expires,
            ),
            refresh_token=security.jwt_handler.create_refresh_token(
                data={"sub": str(user.id), "token_type": "refresh"},
                expires_delta=refresh_token_expires,
            ),
            token_type="Bearer",
            scope="",
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            expires_at=datetime.datetime.now() + access_token_expires,
            issued_at=user.last_login_date,
        )

    async def refresh_token(
        self,
        token: str,
    ) -> schemas.GetAccessTokenResponse:
        """Refresh access token using refresh token"""
        try:
            new_access_token = security.jwt_handler.refresh_token(token)
            return schemas.GetAccessTokenResponse(
                access_token=new_access_token, token_type="bearer"
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Token refresh failed: {e}",
            )

    async def logout(self) -> None:
        """Logout user (this project use JWT that is stateless, revoking token will be done by delete from client)"""
        pass


def get_auth_use_case() -> AuthUseCase:
    """Get AuthUseCase instance"""
    return AuthUseCase()
