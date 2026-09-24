"""Admin use-case for third-party OAuth2 clients (EXT-001, ADR 0002)."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError
from tent_model.third_party_client import ThirdPartyClient

from ...utils.masking import sha256_hex
from ...utils.secret_crypto import SecretEncryptionError, decrypt_secret, encrypt_secret
from ...utils.ulid import new_ulid
from ..thirdparty_auth.provisioning import generate_client_id, generate_client_secret
from .schemas import (
    ThirdPartyClientCreateRequest,
    ThirdPartyClientCreateResponse,
    ThirdPartyClientDeleteResponse,
    ThirdPartyClientListResponse,
    ThirdPartyClientPublic,
    ThirdPartyClientRevokeResponse,
    ThirdPartyClientSecretResponse,
    ThirdPartyClientUpdateRequest,
)


def _to_public(doc: ThirdPartyClient) -> ThirdPartyClientPublic:
    return ThirdPartyClientPublic(
        id=doc.id,
        client_id=doc.client_id,
        name=doc.name,
        description=doc.description,
        module_name=doc.module_name,
        allowed_scopes=doc.allowed_scopes,
        is_active=doc.is_active,
        deleted_at=doc.deleted_at,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


def _duplicate_name(name: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"name '{name}' already exists",
    )


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Third-party client not found",
    )


async def _get_not_deleted(client_row_id: str) -> ThirdPartyClient:
    """Fetch a client, treating a soft-deleted row as not-found (matches list filtering)."""
    doc = await ThirdPartyClient.get(client_row_id)
    if doc is None or doc.deleted_at is not None:
        raise _not_found()
    return doc


class ThirdPartyClientsAdminUseCase:
    async def create(
        self, payload: ThirdPartyClientCreateRequest
    ) -> ThirdPartyClientCreateResponse:
        name = payload.name
        # Case-insensitive pre-check for a clean 409; the unique collation index on `name`
        # still backstops a concurrent create. Only checked against rows still in the
        # list — a soft-deleted client's name is free to reuse.
        existing = await ThirdPartyClient.find_one(
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}, "deleted_at": None}
        )
        if existing is not None:
            raise _duplicate_name(name)

        now = datetime.now(UTC)
        plaintext = generate_client_secret()
        try:
            encrypted = encrypt_secret(plaintext)
        except SecretEncryptionError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="THIRDPARTY_SECRET_ENCRYPTION_KEY is not configured",
            ) from exc
        doc = ThirdPartyClient(
            id=new_ulid(),
            client_id=generate_client_id(),
            client_secret_hash=sha256_hex(plaintext),
            client_secret_encrypted=encrypted,
            name=name,
            description=payload.description,
            module_name=payload.module_name.strip(),
            allowed_scopes=payload.allowed_scopes,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        try:
            await doc.insert()
        except DuplicateKeyError as exc:
            raise _duplicate_name(name) from exc

        public = _to_public(doc)
        return ThirdPartyClientCreateResponse(**public.model_dump(), client_secret=plaintext)

    async def list_clients(self) -> ThirdPartyClientListResponse:
        # Soft-deleted rows stay in Mongo (audit) but never surface in this list.
        docs = await ThirdPartyClient.find({"deleted_at": None}).sort("-created_at").to_list()
        clients = [_to_public(doc) for doc in docs]
        return ThirdPartyClientListResponse(clients=clients, count=len(clients))

    async def revoke(self, client_row_id: str) -> ThirdPartyClientRevokeResponse:
        doc = await _get_not_deleted(client_row_id)
        if doc.is_active:
            doc.is_active = False
            doc.updated_at = datetime.now(UTC)
            await doc.save()
        return ThirdPartyClientRevokeResponse(client=_to_public(doc))

    async def update_scopes(
        self, client_row_id: str, payload: ThirdPartyClientUpdateRequest
    ) -> ThirdPartyClientPublic:
        doc = await _get_not_deleted(client_row_id)
        if not doc.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot edit scopes of a revoked client",
            )
        doc.allowed_scopes = payload.allowed_scopes
        doc.updated_at = datetime.now(UTC)
        await doc.save()
        return _to_public(doc)

    async def reveal_secret(self, client_row_id: str) -> ThirdPartyClientSecretResponse:
        doc = await _get_not_deleted(client_row_id)
        if doc.client_secret_encrypted is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    "This client was created before secret reveal was supported — "
                    "it cannot be recovered. Revoke it and create a new client instead."
                ),
            )
        try:
            plaintext = decrypt_secret(doc.client_secret_encrypted)
        except SecretEncryptionError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="THIRDPARTY_SECRET_ENCRYPTION_KEY is not configured or does not match",
            ) from exc
        return ThirdPartyClientSecretResponse(client_secret=plaintext)

    async def regenerate_secret(self, client_row_id: str) -> ThirdPartyClientCreateResponse:
        """Issue a brand-new secret for the same `client_id` — the old secret stops
        working the instant this saves (its hash is overwritten). Only while active;
        a revoked client's secret can't authenticate anyway (409 CONFLICT otherwise)."""
        doc = await _get_not_deleted(client_row_id)
        if not doc.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot regenerate the secret of a revoked client",
            )
        plaintext = generate_client_secret()
        try:
            encrypted = encrypt_secret(plaintext)
        except SecretEncryptionError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="THIRDPARTY_SECRET_ENCRYPTION_KEY is not configured",
            ) from exc
        doc.client_secret_hash = sha256_hex(plaintext)
        doc.client_secret_encrypted = encrypted
        doc.updated_at = datetime.now(UTC)
        await doc.save()

        public = _to_public(doc)
        return ThirdPartyClientCreateResponse(**public.model_dump(), client_secret=plaintext)

    async def delete(self, client_row_id: str) -> ThirdPartyClientDeleteResponse:
        doc = await _get_not_deleted(client_row_id)
        if doc.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Client must be revoked before it can be deleted",
            )
        doc.deleted_at = datetime.now(UTC)
        await doc.save()
        return ThirdPartyClientDeleteResponse(client=_to_public(doc))


def get_thirdparty_clients_admin_use_case() -> ThirdPartyClientsAdminUseCase:
    return ThirdPartyClientsAdminUseCase()
