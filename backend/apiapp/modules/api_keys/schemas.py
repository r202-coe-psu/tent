"""Admin API key schemas (CR-062)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    owner: str = Field(min_length=1)
    expires_at: datetime
    created_by: str = Field(min_length=1, description="SA Couch username who issues the key")


class ApiKeyPublic(BaseModel):
    """Key metadata without secret material."""

    id: str
    name: str
    owner: str
    key_prefix: str
    expires_at: datetime
    created_by: str
    created_at: datetime
    revoked_at: datetime | None = None
    last_used_at: datetime | None = None


class ApiKeyCreateResponse(ApiKeyPublic):
    """Create response — plaintext ``api_key`` is returned once."""

    api_key: str


class ApiKeyListResponse(BaseModel):
    keys: list[ApiKeyPublic]
    count: int


class ApiKeyRevokeResponse(BaseModel):
    success: bool = True
    key: ApiKeyPublic
