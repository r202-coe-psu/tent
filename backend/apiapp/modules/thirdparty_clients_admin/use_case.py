"""Admin use-case for third-party OAuth2 clients (EXT-001, ADR 0002)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from tent_model.third_party_client import ThirdPartyClient

from ...utils.masking import sha256_hex
from ...utils.ulid import new_ulid
from ..thirdparty_auth.provisioning import generate_client_secret
from .schemas import (
    ThirdPartyClientCreateRequest,
    ThirdPartyClientCreateResponse,
    ThirdPartyClientListResponse,
    ThirdPartyClientPublic,
    ThirdPartyClientRevokeResponse,
)


def _to_public(doc: ThirdPartyClient) -> ThirdPartyClientPublic:
    return ThirdPartyClientPublic(
        id=doc.id,
        client_id=doc.client_id,
        module_name=doc.module_name,
        allowed_scopes=doc.allowed_scopes,
        is_active=doc.is_active,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


class ThirdPartyClientsAdminUseCase:
    async def create(
        self, payload: ThirdPartyClientCreateRequest
    ) -> ThirdPartyClientCreateResponse:
        client_id = payload.client_id.strip()
        existing = await ThirdPartyClient.find_one(ThirdPartyClient.client_id == client_id)
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"client_id '{client_id}' already exists",
            )

        now = datetime.now(UTC)
        plaintext = generate_client_secret()
        doc = ThirdPartyClient(
            id=new_ulid(),
            client_id=client_id,
            client_secret_hash=sha256_hex(plaintext),
            module_name=payload.module_name.strip(),
            allowed_scopes=payload.allowed_scopes,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        await doc.insert()

        public = _to_public(doc)
        return ThirdPartyClientCreateResponse(**public.model_dump(), client_secret=plaintext)

    async def list_clients(self) -> ThirdPartyClientListResponse:
        docs = await ThirdPartyClient.find_all().sort("-created_at").to_list()
        clients = [_to_public(doc) for doc in docs]
        return ThirdPartyClientListResponse(clients=clients, count=len(clients))

    async def revoke(self, client_row_id: str) -> ThirdPartyClientRevokeResponse:
        doc = await ThirdPartyClient.get(client_row_id)
        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Third-party client not found",
            )
        if doc.is_active:
            doc.is_active = False
            doc.updated_at = datetime.now(UTC)
            await doc.save()
        return ThirdPartyClientRevokeResponse(client=_to_public(doc))


def get_thirdparty_clients_admin_use_case() -> ThirdPartyClientsAdminUseCase:
    return ThirdPartyClientsAdminUseCase()
