"""Admin third-party OAuth2 client tests (EXT-001, ADR 0002)."""

from __future__ import annotations

from datetime import UTC, datetime

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
            "name": "  M6 Warehouse Logistics  ",
            "description": "Songkhla warehouse integration",
            "module_name": "M6",
            "allowed_scopes": ["location-read", "location-stock-read"],
        },
    )
    assert create.status_code == 201
    body = create.json()
    assert body["client_id"].startswith("tpc_")
    assert len(body["client_id"]) <= 64
    assert body["name"] == "M6 Warehouse Logistics"
    assert body["description"] == "Songkhla warehouse integration"
    assert body["module_name"] == "M6"
    assert body["allowed_scopes"] == ["location-read", "location-stock-read"]
    assert body["is_active"] is True
    assert body["client_secret"].startswith("tps_")
    assert "client_secret_hash" not in body
    assert "secret_issued_at" not in body

    stored = await ThirdPartyClient.get(body["id"])
    assert stored is not None
    assert stored.client_secret_hash == sha256_hex(body["client_secret"])
    assert stored.secret_issued_at is not None

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


async def test_create_ignores_caller_supplied_client_id(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """client_id is always generated server-side — a caller-supplied one is ignored."""
    response = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={
            "client_id": "m7-command-center",
            "name": "EOC",
            "module_name": "M7",
            "allowed_scopes": ["location-read"],
        },
    )
    assert response.status_code == 201
    assert response.json()["client_id"].startswith("tpc_")
    assert (
        await ThirdPartyClient.find_one(ThirdPartyClient.client_id == "m7-command-center") is None
    )


async def test_create_generates_distinct_client_ids(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ids = set()
    for name in ("EOC A", "EOC B"):
        response = await client.post(
            "/v1/admin/thirdparty-clients",
            headers=auth_headers,
            json={"name": name, "module_name": "M7", "allowed_scopes": ["location-read"]},
        )
        assert response.status_code == 201
        ids.add(response.json()["client_id"])
    assert len(ids) == 2


async def test_create_rejects_duplicate_name_case_insensitive(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    first = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={"name": "EOC Songkhla", "module_name": "M7", "allowed_scopes": ["location-read"]},
    )
    assert first.status_code == 201

    second = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={"name": "eoc songkhla", "module_name": "M6", "allowed_scopes": ["location-read"]},
    )
    assert second.status_code == 409
    assert await ThirdPartyClient.find_all().count() == 1


async def test_create_allows_reusing_a_soft_deleted_clients_name(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Name uniqueness is scoped to rows still in the list — delete frees the name."""
    payload = {"name": "EOC Songkhla", "module_name": "M7", "allowed_scopes": ["location-read"]}
    first = await client.post("/v1/admin/thirdparty-clients", headers=auth_headers, json=payload)
    assert first.status_code == 201
    first_id = first.json()["id"]

    await client.post(f"/v1/admin/thirdparty-clients/{first_id}/revoke", headers=auth_headers)
    deleted = await client.delete(f"/v1/admin/thirdparty-clients/{first_id}", headers=auth_headers)
    assert deleted.status_code == 200

    second = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={"name": "eoc songkhla", "module_name": "M6", "allowed_scopes": ["location-read"]},
    )
    assert second.status_code == 201
    assert second.json()["id"] != first_id


async def test_create_rejects_blank_name(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    response = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={"name": "   ", "module_name": "M6", "allowed_scopes": ["location-read"]},
    )
    assert response.status_code == 422


async def test_create_stores_blank_description_as_none(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={
            "name": "M6 no description",
            "description": "   ",
            "module_name": "M6",
            "allowed_scopes": ["location-read"],
        },
    )
    assert response.status_code == 201
    assert response.json()["description"] is None


async def test_list_returns_legacy_client_without_name(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Docs created before `name` existed still list, with name/description null."""
    now = datetime.now(UTC)
    await ThirdPartyClient(
        id=new_ulid(),
        client_id="m6-warehouse-logistics",
        client_secret_hash=sha256_hex("tps_legacy"),
        module_name="M6",
        allowed_scopes=["location-read"],
        created_at=now,
        updated_at=now,
    ).insert()

    listed = await client.get("/v1/admin/thirdparty-clients", headers=auth_headers)
    assert listed.status_code == 200
    legacy = listed.json()["clients"][0]
    assert legacy["client_id"] == "m6-warehouse-logistics"
    assert legacy["name"] is None
    assert legacy["description"] is None


async def test_create_allows_occupancy_pii_read_scope(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """EXT-007's PII scope is now grantable through this admin surface, per written approval."""
    response = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={
            "name": "M7 PII",
            "module_name": "M7",
            "allowed_scopes": ["location-read", "occupancy-pii-read"],
        },
    )
    assert response.status_code == 201

    created = await ThirdPartyClient.get(response.json()["id"])
    assert created is not None
    assert "occupancy-pii-read" in created.allowed_scopes


async def test_create_rejects_unknown_module_name(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Only the two known partner modules (M6, M7) are accepted — not free text."""
    response = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={
            "name": "mystery-client",
            "module_name": "M9",
            "allowed_scopes": ["location-read"],
        },
    )
    assert response.status_code == 422
    assert await ThirdPartyClient.find_one(ThirdPartyClient.name == "mystery-client") is None


async def test_create_rejects_ungrantable_scope(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Only scopes in THIRD_PARTY_SCOPES are grantable — same validator as PATCH."""
    response = await client.post(
        "/v1/admin/thirdparty-clients",
        headers=auth_headers,
        json={
            "name": "scope-ghost",
            "module_name": "M6",
            "allowed_scopes": ["not-a-real-scope"],
        },
    )
    assert response.status_code == 422
    assert await ThirdPartyClient.find_one(ThirdPartyClient.name == "scope-ghost") is None


async def test_revoke_unknown_client_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        f"/v1/admin/thirdparty-clients/{new_ulid()}/revoke", headers=auth_headers
    )
    assert response.status_code == 404


async def _create_client(
    client: AsyncClient, auth_headers: dict[str, str], **overrides: object
) -> dict:
    payload: dict[str, object] = {
        "name": "EOC Reveal",
        "module_name": "M7",
        "allowed_scopes": ["location-read"],
    }
    payload.update(overrides)
    response = await client.post("/v1/admin/thirdparty-clients", headers=auth_headers, json=payload)
    assert response.status_code == 201
    return response.json()


async def test_reveal_secret_returns_original_plaintext(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)

    revealed = await client.get(
        f"/v1/admin/thirdparty-clients/{created['id']}/secret", headers=auth_headers
    )
    assert revealed.status_code == 200
    assert revealed.json()["client_secret"] == created["client_secret"]


async def test_reveal_secret_unknown_client_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.get(
        f"/v1/admin/thirdparty-clients/{new_ulid()}/secret", headers=auth_headers
    )
    assert response.status_code == 404


async def test_reveal_secret_legacy_client_without_issued_at_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    now = datetime.now(UTC)
    doc = await ThirdPartyClient(
        id=new_ulid(),
        client_id="m6-legacy",
        client_secret_hash=sha256_hex("tps_legacy"),
        module_name="M6",
        allowed_scopes=["location-read"],
        created_at=now,
        updated_at=now,
    ).insert()

    response = await client.get(
        f"/v1/admin/thirdparty-clients/{doc.id}/secret", headers=auth_headers
    )
    assert response.status_code == 404


async def test_update_scopes_while_active(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers, allowed_scopes=["location-read"])

    updated = await client.patch(
        f"/v1/admin/thirdparty-clients/{created['id']}",
        headers=auth_headers,
        json={"allowed_scopes": ["location-read", "occupancy-pii-read"]},
    )
    assert updated.status_code == 200
    assert updated.json()["allowed_scopes"] == ["location-read", "occupancy-pii-read"]

    stored = await ThirdPartyClient.get(created["id"])
    assert stored is not None
    assert stored.allowed_scopes == ["location-read", "occupancy-pii-read"]


async def test_update_scopes_rejects_ungrantable_scope(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)

    response = await client.patch(
        f"/v1/admin/thirdparty-clients/{created['id']}",
        headers=auth_headers,
        json={"allowed_scopes": ["not-a-real-scope"]},
    )
    assert response.status_code == 422


async def test_update_scopes_refused_once_revoked(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)
    await client.post(f"/v1/admin/thirdparty-clients/{created['id']}/revoke", headers=auth_headers)

    response = await client.patch(
        f"/v1/admin/thirdparty-clients/{created['id']}",
        headers=auth_headers,
        json={"allowed_scopes": ["location-read"]},
    )
    assert response.status_code == 409


async def test_delete_refused_while_active(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)

    response = await client.delete(
        f"/v1/admin/thirdparty-clients/{created['id']}", headers=auth_headers
    )
    assert response.status_code == 409

    stored = await ThirdPartyClient.get(created["id"])
    assert stored is not None
    assert stored.deleted_at is None


async def test_delete_after_revoke_soft_deletes_and_hides_from_list(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)
    await client.post(f"/v1/admin/thirdparty-clients/{created['id']}/revoke", headers=auth_headers)

    deleted = await client.delete(
        f"/v1/admin/thirdparty-clients/{created['id']}", headers=auth_headers
    )
    assert deleted.status_code == 200
    assert deleted.json()["success"] is True

    stored = await ThirdPartyClient.get(created["id"])
    assert stored is not None
    assert stored.deleted_at is not None

    listed = await client.get("/v1/admin/thirdparty-clients", headers=auth_headers)
    assert listed.json()["count"] == 0

    revealed = await client.get(
        f"/v1/admin/thirdparty-clients/{created['id']}/secret", headers=auth_headers
    )
    assert revealed.status_code == 404


async def test_delete_unknown_client_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.delete(
        f"/v1/admin/thirdparty-clients/{new_ulid()}", headers=auth_headers
    )
    assert response.status_code == 404


async def test_regenerate_secret_issues_new_secret_same_client_id(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)

    regenerated = await client.post(
        f"/v1/admin/thirdparty-clients/{created['id']}/regenerate-secret",
        headers=auth_headers,
    )
    assert regenerated.status_code == 200
    body = regenerated.json()
    assert body["client_id"] == created["client_id"]
    assert body["client_secret"].startswith("tps_")
    assert body["client_secret"] != created["client_secret"]


async def test_regenerate_secret_invalidates_old_secret(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)
    regenerated = await client.post(
        f"/v1/admin/thirdparty-clients/{created['id']}/regenerate-secret",
        headers=auth_headers,
    )
    new_secret = regenerated.json()["client_secret"]

    old_token = await client.post(
        "/external/token",
        json={
            "grant_type": "client_credentials",
            "client_id": created["client_id"],
            "client_secret": created["client_secret"],
        },
    )
    assert old_token.status_code == 401

    new_token = await client.post(
        "/external/token",
        json={
            "grant_type": "client_credentials",
            "client_id": created["client_id"],
            "client_secret": new_secret,
        },
    )
    assert new_token.status_code == 200


async def test_regenerate_secret_reveal_matches_new_secret(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)
    regenerated = await client.post(
        f"/v1/admin/thirdparty-clients/{created['id']}/regenerate-secret",
        headers=auth_headers,
    )
    new_secret = regenerated.json()["client_secret"]

    revealed = await client.get(
        f"/v1/admin/thirdparty-clients/{created['id']}/secret", headers=auth_headers
    )
    assert revealed.json()["client_secret"] == new_secret


async def test_regenerate_secret_refused_once_revoked(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _create_client(client, auth_headers)
    await client.post(f"/v1/admin/thirdparty-clients/{created['id']}/revoke", headers=auth_headers)

    response = await client.post(
        f"/v1/admin/thirdparty-clients/{created['id']}/regenerate-secret",
        headers=auth_headers,
    )
    assert response.status_code == 409


async def test_regenerate_secret_unknown_client_returns_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        f"/v1/admin/thirdparty-clients/{new_ulid()}/regenerate-secret",
        headers=auth_headers,
    )
    assert response.status_code == 404
