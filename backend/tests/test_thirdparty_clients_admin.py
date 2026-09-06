"""Admin third-party OAuth2 client tests (EXT-001, ADR 0002)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from tent_model.third_party_client import ThirdPartyClient

from apiapp.core.config import Settings
from apiapp.utils.masking import sha256_hex
from apiapp.utils.ulid import new_ulid


@pytest.fixture
def auth_headers(settings: Settings) -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.EXTERNAL_API_SECRET}"}


async def test_admin_thirdparty_clients_require_bearer(client: AsyncClient) -> None:
    response = await client.get("/v1/admin/thirdparty-clients")
    assert response.status_code == 401


async def test_create_list_revoke_thirdparty_client(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    create = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={
            "client_id": "m6-warehouse-logistics",
            "module_name": "M6",
            "allowed_scopes": ["location-read", "location-stock-read"],
        },
    )
    assert create.status_code == 201
    body = create.json()
    assert body["client_id"] == "m6-warehouse-logistics"
    assert body["module_name"] == "M6"
    assert body["allowed_scopes"] == ["location-read", "location-stock-read"]
    assert body["is_active"] is True
    assert body["client_secret"].startswith("tps_")
    assert "client_secret_hash" not in body

    stored = await ThirdPartyClient.get(body["id"])
    assert stored is not None
    assert stored.client_secret_hash == sha256_hex(body["client_secret"])

    listed = await client.get("/v1/admin/thirdparty-clients", headers=auth_headers)
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["count"] == 1
    assert listed_body["clients"][0]["id"] == body["id"]
    assert "client_secret" not in listed_body["clients"][0]
    assert "client_secret_hash" not in listed_body["clients"][0]

    revoked = await client.post(
        f"/v1/admin/thirdparty-clients/{body['id']}/revoke",
        headers=auth_headers,
    )
    assert revoked.status_code == 200
    assert revoked.json()["success"] is True
    assert revoked.json()["client"]["is_active"] is False

    stored_after = await ThirdPartyClient.get(body["id"])
    assert stored_after is not None
    assert stored_after.is_active is False


async def test_create_rejects_duplicate_client_id(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = {
        "client_id": "m7-command-center",
        "module_name": "M7",
        "allowed_scopes": ["location-read"],
    }
    first = await client.post("/v1/admin/thirdparty-clients", headers=auth_headers, json=payload)
    assert first.status_code == 201

    second = await client.post("/v1/admin/thirdparty-clients", headers=auth_headers, json=payload)
    assert second.status_code == 409


async def test_create_rejects_occupancy_pii_read_scope(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """EXT-007 stays denied by default — this admin surface can never grant the PII scope."""
    response = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={
            "client_id": "sneaky-client",
            "module_name": "M6",
            "allowed_scopes": ["location-read", "occupancy-pii-read"],
        },
    )
    assert response.status_code == 422

    assert await ThirdPartyClient.find_one(ThirdPartyClient.client_id == "sneaky-client") is None


async def test_create_rejects_unknown_module_name(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Only the two known partner modules (M6, M7) are accepted — not free text."""
    response = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={
            "client_id": "mystery-client",
            "module_name": "M9",
            "allowed_scopes": ["location-read"],
        },
    )
    assert response.status_code == 422
    assert await ThirdPartyClient.find_one(ThirdPartyClient.client_id == "mystery-client") is None


async def test_revoke_unknown_client_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        f"/v1/admin/thirdparty-clients/{new_ulid()}/revoke", headers=auth_headers
    )
    assert response.status_code == 404
