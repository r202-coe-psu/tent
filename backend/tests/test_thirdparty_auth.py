"""EXT-001 — third-party OAuth2 client-credentials token endpoint tests (ADR 0002)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from httpx import AsyncClient
from tent_model.third_party_client import ThirdPartyClient

from apiapp.modules.thirdparty_auth.scopes import (
    mint_access_token,
    require_scope,
    verify_thirdparty_token,
)
from apiapp.utils.masking import sha256_hex
from apiapp.utils.ulid import new_ulid

CLIENT_SECRET = "s3cr3t-plaintext"


@pytest.fixture
async def active_client() -> ThirdPartyClient:
    now = datetime.now(UTC)
    doc = ThirdPartyClient(
        id=new_ulid(),
        client_id="m6-test-client",
        client_secret_hash=sha256_hex(CLIENT_SECRET),
        module_name="M6",
        allowed_scopes=["location-read", "location-stock-read"],
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    await doc.insert()
    return doc


@pytest.fixture
async def inactive_client() -> ThirdPartyClient:
    now = datetime.now(UTC)
    doc = ThirdPartyClient(
        id=new_ulid(),
        client_id="m6-revoked-client",
        client_secret_hash=sha256_hex(CLIENT_SECRET),
        module_name="M6",
        allowed_scopes=["location-read"],
        is_active=False,
        created_at=now,
        updated_at=now,
    )
    await doc.insert()
    return doc


async def _request_token(
    client: AsyncClient,
    *,
    client_id: str,
    client_secret: str,
    grant_type: str = "client_credentials",
):
    return await client.post(
        "/api/auth/token-third-party",
        json={"grant_type": grant_type, "client_id": client_id, "client_secret": client_secret},
    )


async def test_valid_client_receives_scoped_token(
    client: AsyncClient, active_client: ThirdPartyClient
) -> None:
    response = await _request_token(
        client, client_id=active_client.client_id, client_secret=CLIENT_SECRET
    )
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 3600
    assert body["module_name"] == "M6"
    assert body["scopes"] == ["location-read", "location-stock-read"]
    assert isinstance(body["access_token"], str) and body["access_token"]


async def test_scope_comes_from_db_not_request_body(
    client: AsyncClient, active_client: ThirdPartyClient
) -> None:
    """`grant_type`/`client_id`/`client_secret` are the only accepted fields — no scope override."""
    response = await client.post(
        "/api/auth/token-third-party",
        json={
            "grant_type": "client_credentials",
            "client_id": active_client.client_id,
            "client_secret": CLIENT_SECRET,
            "scopes": ["occupancy-pii-read"],
        },
    )
    assert response.status_code == 200
    assert response.json()["scopes"] == ["location-read", "location-stock-read"]


async def test_unknown_client_id_rejected(client: AsyncClient) -> None:
    response = await _request_token(client, client_id="does-not-exist", client_secret="whatever")
    assert response.status_code == 401
    body = response.json()
    assert body["status"] == 401
    assert body["code"] == "invalid_client"
    # Partner ODT's own documented 401 example — same message for every failure mode
    # below (never reveals which check failed, to avoid client-enumeration).
    assert body["message"] == "Invalid client credentials."


async def test_invalid_secret_rejected(
    client: AsyncClient, active_client: ThirdPartyClient
) -> None:
    response = await _request_token(
        client, client_id=active_client.client_id, client_secret="wrong-secret"
    )
    assert response.status_code == 401
    body = response.json()
    assert body["code"] == "invalid_client"
    assert body["message"] == "Invalid client credentials."


async def test_inactive_client_rejected(
    client: AsyncClient, inactive_client: ThirdPartyClient
) -> None:
    response = await _request_token(
        client, client_id=inactive_client.client_id, client_secret=CLIENT_SECRET
    )
    assert response.status_code == 401
    body = response.json()
    assert body["code"] == "invalid_client"
    assert body["message"] == "Invalid client credentials."


async def test_unsupported_grant_type_rejected(
    client: AsyncClient, active_client: ThirdPartyClient
) -> None:
    response = await _request_token(
        client,
        client_id=active_client.client_id,
        client_secret=CLIENT_SECRET,
        grant_type="password",
    )
    assert response.status_code == 400
    body = response.json()
    assert body["status"] == 400
    assert body["code"] == "unsupported_grant_type"


async def test_client_id_over_max_length_rejected(client: AsyncClient) -> None:
    """Partner ODT: `client_id Text(64)`."""
    response = await _request_token(client, client_id="x" * 65, client_secret="whatever")
    assert response.status_code == 422


async def test_client_secret_over_max_length_rejected(
    client: AsyncClient, active_client: ThirdPartyClient
) -> None:
    """Partner ODT: `client_secret Text(128)`."""
    response = await _request_token(
        client, client_id=active_client.client_id, client_secret="x" * 129
    )
    assert response.status_code == 422


async def test_require_scope_rejects_missing_claim() -> None:
    """`require_scope` — the dependency later EXT-002+ tickets protect endpoints with."""
    token, _ = mint_access_token(
        client_id="m6-test-client", module_name="M6", scopes=["location-read"]
    )
    claims = await verify_thirdparty_token(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    )
    assert claims.scopes == ["location-read"]

    dependency = require_scope("occupancy-read")
    with pytest.raises(HTTPException) as exc_info:
        await dependency(claims)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail["error"]["code"] == "insufficient_scope"

    # A claim that is present passes through unchanged.
    passthrough = await require_scope("location-read")(claims)
    assert passthrough is claims


async def test_verify_thirdparty_token_rejects_garbage_token() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await verify_thirdparty_token(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="not-a-jwt")
        )
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["error"]["code"] == "invalid_token"
