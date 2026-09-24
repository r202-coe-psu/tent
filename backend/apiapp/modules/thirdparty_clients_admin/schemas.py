"""Admin schemas for third-party OAuth2 clients (EXT-001, ADR 0002)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator
from tent_model.third_party_client import THIRD_PARTY_SCOPES

# All scopes defined on the third-party client model are grantable here, including
# `occupancy-pii-read` (EXT-007) — enabled per written approval from the project owner.
GRANTABLE_SCOPES: tuple[str, ...] = THIRD_PARTY_SCOPES

# Only these two partner systems exist today (ADR 0002 / ext-spec.md). Kept as a
# closed set — not free text — so a client can't be created under a typo'd or
# unknown module name.
PARTNER_MODULES: tuple[str, ...] = ("M6", "M7")

NAME_MAX_LENGTH = 100
DESCRIPTION_MAX_LENGTH = 500


def _validate_scopes(value: list[str]) -> list[str]:
    invalid = sorted(set(value) - set(GRANTABLE_SCOPES))
    if invalid:
        raise ValueError(
            f"scope(s) not grantable here: {', '.join(invalid)} — "
            f"allowed: {', '.join(GRANTABLE_SCOPES)}"
        )
    return value


class ThirdPartyClientCreateRequest(BaseModel):
    """``client_id`` is generated server-side (``tpc_…``) — not accepted from the caller."""

    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)
    module_name: str = Field(min_length=1)
    allowed_scopes: list[str] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def _name_must_not_be_blank(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("name must not be blank")
        return trimmed

    @field_validator("description")
    @classmethod
    def _blank_description_is_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("module_name")
    @classmethod
    def _module_must_be_known(cls, value: str) -> str:
        if value not in PARTNER_MODULES:
            raise ValueError(f"module_name must be one of: {', '.join(PARTNER_MODULES)}")
        return value

    @field_validator("allowed_scopes")
    @classmethod
    def _scopes_must_be_grantable(cls, value: list[str]) -> list[str]:
        return _validate_scopes(value)


class ThirdPartyClientUpdateRequest(BaseModel):
    """``PATCH`` body — scopes only. Refused (409) once the client is revoked."""

    allowed_scopes: list[str] = Field(min_length=1)

    @field_validator("allowed_scopes")
    @classmethod
    def _scopes_must_be_grantable(cls, value: list[str]) -> list[str]:
        return _validate_scopes(value)


class ThirdPartyClientPublic(BaseModel):
    """Client metadata without the secret hash/ciphertext."""

    id: str
    client_id: str
    name: str | None
    description: str | None
    module_name: str
    allowed_scopes: list[str]
    is_active: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ThirdPartyClientCreateResponse(ThirdPartyClientPublic):
    """Create response — plaintext ``client_secret`` is returned once."""

    client_secret: str


class ThirdPartyClientListResponse(BaseModel):
    clients: list[ThirdPartyClientPublic]
    count: int


class ThirdPartyClientRevokeResponse(BaseModel):
    success: bool = True
    client: ThirdPartyClientPublic


class ThirdPartyClientDeleteResponse(BaseModel):
    success: bool = True
    client: ThirdPartyClientPublic


class ThirdPartyClientSecretResponse(BaseModel):
    client_secret: str
