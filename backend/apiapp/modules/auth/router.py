"""
Auth API router — secret-token verification for external callers
"""

from fastapi import APIRouter, Depends

from . import schemas
from ...core.security import verify_external_secret

router = APIRouter(prefix="/v1/auth", tags=["Authentication"])


@router.get("/verify", response_model=schemas.VerifyResponse)
async def verify_auth(_: None = Depends(verify_external_secret)) -> schemas.VerifyResponse:
	"""Verify connectivity using EXTERNAL_API_SECRET Bearer token."""
	return schemas.VerifyResponse()
