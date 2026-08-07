"""Admin API key use-case (CR-062)."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

from fastapi import HTTPException, status
from tent_model.api_key import ApiKey

from ...core.security import KEY_PREFIX_LEN
from ...utils.masking import sha256_hex
from ...utils.ulid import new_ulid
from .schemas import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyListResponse,
    ApiKeyPublic,
    ApiKeyRevokeResponse,
)

_SECRET_PREFIX = "tsk_"
# urlsafe ~43 chars → high entropy after fixed prefix
_SECRET_BYTES = 32
_MAX_PREFIX_RETRIES = 8


def _generate_secret() -> str:
    return f"{_SECRET_PREFIX}{secrets.token_urlsafe(_SECRET_BYTES)}"


def _to_public(doc: ApiKey) -> ApiKeyPublic:
    return ApiKeyPublic(
        id=doc.id,
        name=doc.name,
        owner=doc.owner,
        key_prefix=doc.key_prefix,
        expires_at=doc.expires_at,
        created_by=doc.created_by,
        created_at=doc.created_at,
        revoked_at=doc.revoked_at,
        last_used_at=doc.last_used_at,
    )


class ApiKeysUseCase:
    async def create(self, payload: ApiKeyCreateRequest) -> ApiKeyCreateResponse:
        expires_at = payload.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        now = datetime.now(UTC)
        if expires_at <= now:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="expires_at must be in the future",
            )

        plaintext: str | None = None
        prefix: str | None = None
        for _ in range(_MAX_PREFIX_RETRIES):
            candidate = _generate_secret()
            candidate_prefix = candidate[:KEY_PREFIX_LEN]
            existing = await ApiKey.find_one(ApiKey.key_prefix == candidate_prefix)
            if existing is None:
                plaintext = candidate
                prefix = candidate_prefix
                break

        if plaintext is None or prefix is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Unable to allocate a unique key prefix",
            )

        doc = ApiKey(
            id=new_ulid(),
            name=payload.name.strip(),
            owner=payload.owner.strip(),
            key_prefix=prefix,
            key_hash=sha256_hex(plaintext),
            expires_at=expires_at,
            created_by=payload.created_by.strip(),
            created_at=now,
        )
        await doc.insert()

        public = _to_public(doc)
        return ApiKeyCreateResponse(**public.model_dump(), api_key=plaintext)

    async def list_keys(self) -> ApiKeyListResponse:
        docs = await ApiKey.find_all().sort("-created_at").to_list()
        keys = [_to_public(doc) for doc in docs]
        return ApiKeyListResponse(keys=keys, count=len(keys))

    async def revoke(self, key_id: str) -> ApiKeyRevokeResponse:
        doc = await ApiKey.get(key_id)
        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="API key not found",
            )
        if doc.revoked_at is None:
            doc.revoked_at = datetime.now(UTC)
            await doc.save()
        return ApiKeyRevokeResponse(key=_to_public(doc))


def get_api_keys_use_case() -> ApiKeysUseCase:
    return ApiKeysUseCase()
