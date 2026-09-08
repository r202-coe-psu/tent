"""JWT mint/verify and scope enforcement for the third-party plane (EXT-001, ADR 0002)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ...core.config import settings

JWT_ALGORITHM = "HS256"

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class ThirdPartyClaims:
    client_id: str
    module_name: str
    scopes: list[str]


def mint_access_token(client_id: str, module_name: str, scopes: list[str]) -> tuple[str, int]:
    """Mint a scoped HS256 JWT (ADR 0002: 3,600s lifetime, scopes embedded from the DB)."""
    now = datetime.now(UTC)
    expires_in = settings.THIRDPARTY_JWT_EXPIRE_SECONDS
    payload = {
        "sub": client_id,
        "module_name": module_name,
        "scope": " ".join(scopes),
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
    }
    token = jwt.encode(payload, settings.THIRDPARTY_JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, expires_in


def _invalid_token(message: str = "Invalid or missing bearer token") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": "invalid_token", "message": message}},
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_thirdparty_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
) -> ThirdPartyClaims:
    """Decode and validate a third-party Bearer JWT — scope check lives in ``require_scope``."""
    if not credentials or credentials.scheme.lower() != "bearer":
        raise _invalid_token()

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.THIRDPARTY_JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError as exc:
        raise _invalid_token("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise _invalid_token() from exc

    scope = payload.get("scope", "")
    return ThirdPartyClaims(
        client_id=payload.get("sub", ""),
        module_name=payload.get("module_name", ""),
        scopes=scope.split() if scope else [],
    )


def require_scope(required_scope: str):
    """Dependency factory — raises ``403 insufficient_scope`` when the token lacks the claim."""

    async def _dependency(
        claims: Annotated[ThirdPartyClaims, Depends(verify_thirdparty_token)],
    ) -> ThirdPartyClaims:
        if required_scope not in claims.scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": {
                        "code": "insufficient_scope",
                        "message": f"scope '{required_scope}' is required",
                    }
                },
            )
        return claims

    return _dependency
