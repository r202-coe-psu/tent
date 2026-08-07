"""API keys admin + external keyed route tests (CR-062)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from tent_model.api_key import ApiKey
from tent_model.public_shelter import PublicShelter

from apiapp.core.config import Settings
from apiapp.utils.masking import sha256_hex
from apiapp.utils.ulid import new_ulid


@pytest.fixture
def auth_headers(settings: Settings) -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.EXTERNAL_API_SECRET}"}


@pytest.fixture
async def open_shelter() -> PublicShelter:
    shelter = PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="Test Shelter",
        status="open",
        capacity=100,
        updated_at=datetime.now(UTC),
    )
    await shelter.insert()
    return shelter


def _future_expiry(**kwargs: object) -> str:
    delta = timedelta(**kwargs) if kwargs else timedelta(days=30)
    return (datetime.now(UTC) + delta).isoformat()


async def test_create_list_revoke_api_key(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    create = await client.post(
        "/v1/admin/api-keys",
        headers=auth_headers,
        json={
            "name": "Hat Yai ROD",
            "owner": "ROD",
            "expires_at": _future_expiry(days=90),
            "created_by": "admin",
        },
    )
    assert create.status_code == 201
    body = create.json()
    assert body["name"] == "Hat Yai ROD"
    assert body["owner"] == "ROD"
    assert body["created_by"] == "admin"
    assert body["revoked_at"] is None
    assert body["api_key"].startswith("tsk_")
    assert body["key_prefix"] == body["api_key"][:8]
    assert "key_hash" not in body

    stored = await ApiKey.get(body["id"])
    assert stored is not None
    assert stored.key_hash == sha256_hex(body["api_key"])
    assert stored.key_prefix == body["key_prefix"]

    listed = await client.get("/v1/admin/api-keys", headers=auth_headers)
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["count"] == 1
    assert listed_body["keys"][0]["id"] == body["id"]
    assert "api_key" not in listed_body["keys"][0]
    assert "key_hash" not in listed_body["keys"][0]

    revoked = await client.post(
        f"/v1/admin/api-keys/{body['id']}/revoke",
        headers=auth_headers,
    )
    assert revoked.status_code == 200
    assert revoked.json()["success"] is True
    assert revoked.json()["key"]["revoked_at"] is not None

    stored_after = await ApiKey.get(body["id"])
    assert stored_after is not None
    assert stored_after.revoked_at is not None


async def test_admin_api_keys_require_bearer(client: AsyncClient) -> None:
    response = await client.get("/v1/admin/api-keys")
    assert response.status_code == 401


async def test_external_shelters_requires_api_key(
    client: AsyncClient, open_shelter: PublicShelter
) -> None:
    missing = await client.get("/external/v1/shelters")
    assert missing.status_code == 401

    invalid = await client.get(
        "/external/v1/shelters",
        headers={"X-API-Key": "tsk_not-a-real-key-xxxxxxxxxx"},
    )
    assert invalid.status_code == 401

    anonymous_public = await client.get("/public/v1/shelters")
    assert anonymous_public.status_code == 401


async def test_external_shelters_with_valid_key(
    client: AsyncClient,
    auth_headers: dict[str, str],
    open_shelter: PublicShelter,
) -> None:
    create = await client.post(
        "/v1/admin/api-keys",
        headers=auth_headers,
        json={
            "name": "Agency",
            "owner": "Agency Org",
            "expires_at": _future_expiry(days=30),
            "created_by": "admin",
        },
    )
    assert create.status_code == 201
    api_key = create.json()["api_key"]

    response = await client.get(
        "/external/v1/shelters",
        headers={"X-API-Key": api_key},
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["shelters"][0]["code"] == "SH001"

    stored = await ApiKey.get(create.json()["id"])
    assert stored is not None
    assert stored.last_used_at is not None


async def test_external_rejects_expired_key(
    client: AsyncClient, open_shelter: PublicShelter
) -> None:
    plaintext = "tsk_expiredkey_entropy_padding_xx"
    doc = ApiKey(
        id=new_ulid(),
        name="Expired",
        owner="Test",
        key_prefix=plaintext[:8],
        key_hash=sha256_hex(plaintext),
        expires_at=datetime.now(UTC) - timedelta(hours=1),
        created_by="admin",
        created_at=datetime.now(UTC) - timedelta(days=2),
    )
    await doc.insert()

    response = await client.get(
        "/external/v1/shelters",
        headers={"X-API-Key": plaintext},
    )
    assert response.status_code == 401


async def test_external_rejects_revoked_key(
    client: AsyncClient, open_shelter: PublicShelter
) -> None:
    plaintext = "tsk_revokedkey_entropy_padding_xx"
    doc = ApiKey(
        id=new_ulid(),
        name="Revoked",
        owner="Test",
        key_prefix=plaintext[:8],
        key_hash=sha256_hex(plaintext),
        expires_at=datetime.now(UTC) + timedelta(days=30),
        created_by="admin",
        created_at=datetime.now(UTC),
        revoked_at=datetime.now(UTC),
    )
    await doc.insert()

    response = await client.get(
        "/external/v1/shelters",
        headers={"X-API-Key": plaintext},
    )
    assert response.status_code == 401


async def test_revoke_unknown_key_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/v1/admin/api-keys/01HZZZZZZZZZZZZZZZZZZZZZZZ/revoke",
        headers=auth_headers,
    )
    assert response.status_code == 404
