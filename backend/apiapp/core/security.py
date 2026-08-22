import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from tent_model.api_key import ApiKey

from ..utils.masking import sha256_hex
from .config import settings

_bearer = HTTPBearer(auto_error=False)
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

KEY_PREFIX_LEN = 8


async def verify_external_secret(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> None:
    """Validate service-to-service Bearer token against EXTERNAL_API_SECRET."""
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not settings.EXTERNAL_API_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="External API secret is not configured",
        )

    if not secrets.compare_digest(credentials.credentials, settings.EXTERNAL_API_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API secret",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _unauthorized(detail: str = "Invalid or missing API key") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": "unauthorized", "message": detail}},
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_api_key(
    bearer_creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
    api_key_header: Annotated[str | None, Security(_api_key_header)] = None,
) -> ApiKey:
    """Validate managed consumer key from ``Authorization: Bearer`` or ``X-API-Key`` (CR-062)."""
    api_key: str | None = None
    if bearer_creds and bearer_creds.credentials:
        api_key = bearer_creds.credentials
    elif api_key_header:
        api_key = api_key_header

    if not api_key or not api_key.startswith("tsk_") or len(api_key) < KEY_PREFIX_LEN:
        raise _unauthorized()

    prefix = api_key[:KEY_PREFIX_LEN]
    doc = await ApiKey.find_one(ApiKey.key_prefix == prefix)
    if doc is None:
        raise _unauthorized()

    expected = sha256_hex(api_key)
    if not secrets.compare_digest(doc.key_hash, expected):
        raise _unauthorized()

    if doc.revoked_at is not None:
        raise _unauthorized("API key has been revoked")

    now = datetime.now(UTC)
    expires = doc.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if now >= expires:
        raise _unauthorized("API key has expired")

    doc.last_used_at = now
    await doc.save()
    return doc
