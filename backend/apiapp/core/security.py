import secrets
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

_bearer = HTTPBearer(auto_error=False)


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
