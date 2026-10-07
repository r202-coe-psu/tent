"""Tests for the keyed /external/v1 plane (CR-062 dual auth); M2 endpoints removed by CR-154."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from tent_model.api_key import ApiKey
from tent_model.public_shelter import GeoPoint, PublicShelter

from apiapp.utils.masking import sha256_hex
from apiapp.utils.ulid import new_ulid


@pytest.fixture
def test_api_key_plaintext() -> str:
    return "tsk_valid_test_api_key_entropy_1234567890"


@pytest.fixture
async def valid_api_key(test_api_key_plaintext: str) -> ApiKey:
    doc = ApiKey(
        id=new_ulid(),
        name="M2 Consumer",
        owner="M2 System",
        key_prefix=test_api_key_plaintext[:8],
        key_hash=sha256_hex(test_api_key_plaintext),
        expires_at=datetime.now(UTC) + timedelta(days=365),
        created_by="admin",
        created_at=datetime.now(UTC),
    )
    await doc.insert()
    return doc


@pytest.fixture
def bearer_headers(test_api_key_plaintext: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {test_api_key_plaintext}"}


@pytest.fixture
def x_api_key_headers(test_api_key_plaintext: str) -> dict[str, str]:
    return {"X-API-Key": test_api_key_plaintext}


@pytest.fixture
async def sample_shelters() -> list[PublicShelter]:
    now = datetime.now(UTC)
    s1 = PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์พักพิงเทศบาล 1",
        status="open",
        capacity=100,
        geo=GeoPoint(lat=7.0084, lng=100.4767),
        updated_at=now,
    )
    s2 = PublicShelter(
        id="SH002",
        shelter_code="SH002",
        name="ศูนย์พักพิงโรงเรียน 2",
        status="closed",
        capacity=50,
        geo=None,
        updated_at=now,
    )
    await s1.insert()
    await s2.insert()
    return [s1, s2]


async def test_auth_bearer_and_x_api_key(
    client: AsyncClient,
    valid_api_key: ApiKey,
    bearer_headers: dict[str, str],
    x_api_key_headers: dict[str, str],
    sample_shelters: list[PublicShelter],
) -> None:
    # 1. Bearer Token
    res_bearer = await client.get("/external/v1/needs", headers=bearer_headers)
    assert res_bearer.status_code == 200

    # 2. X-API-Key
    res_x_key = await client.get("/external/v1/needs", headers=x_api_key_headers)
    assert res_x_key.status_code == 200

    # 3. Missing Auth
    res_missing = await client.get("/external/v1/needs")
    assert res_missing.status_code == 401
    assert res_missing.json()["error"]["code"] == "unauthorized"

    # 4. Invalid Token
    res_invalid = await client.get(
        "/external/v1/needs",
        headers={"Authorization": "Bearer tsk_invalid_key_12345"},
    )
    assert res_invalid.status_code == 401
    assert res_invalid.json()["error"]["code"] == "unauthorized"


async def test_auth_expired_and_revoked_keys(
    client: AsyncClient,
    sample_shelters: list[PublicShelter],
) -> None:
    # Expired key
    exp_plain = "tsk_expired_key_test_123456789"
    exp_doc = ApiKey(
        id=new_ulid(),
        name="Expired M2",
        owner="M2",
        key_prefix=exp_plain[:8],
        key_hash=sha256_hex(exp_plain),
        expires_at=datetime.now(UTC) - timedelta(hours=1),
        created_by="admin",
        created_at=datetime.now(UTC) - timedelta(days=2),
    )
    await exp_doc.insert()

    res_exp = await client.get(
        "/external/v1/needs",
        headers={"Authorization": f"Bearer {exp_plain}"},
    )
    assert res_exp.status_code == 401
    assert res_exp.json()["error"]["code"] == "unauthorized"
    assert "expired" in res_exp.json()["error"]["message"]

    # Revoked key
    rev_plain = "tsk_revoked_key_test_123456789"
    rev_doc = ApiKey(
        id=new_ulid(),
        name="Revoked M2",
        owner="M2",
        key_prefix=rev_plain[:8],
        key_hash=sha256_hex(rev_plain),
        expires_at=datetime.now(UTC) + timedelta(days=10),
        created_by="admin",
        created_at=datetime.now(UTC),
        revoked_at=datetime.now(UTC),
    )
    await rev_doc.insert()

    res_rev = await client.get(
        "/external/v1/needs",
        headers={"Authorization": f"Bearer {rev_plain}"},
    )
    assert res_rev.status_code == 401
    assert res_rev.json()["error"]["code"] == "unauthorized"
    assert "revoked" in res_rev.json()["error"]["message"]


async def test_m2_v1_endpoints_removed(
    client: AsyncClient, bearer_headers: dict[str, str], valid_api_key: ApiKey
) -> None:
    """CR-154: M2 moved to the partner plane — the old /external/v1 routes are gone."""
    res_list = await client.get("/external/v1/shelters", headers=bearer_headers)
    assert res_list.status_code == 404
    res_residency = await client.get(
        "/external/v1/persons/shelter-residency?cid=1909800123456", headers=bearer_headers
    )
    assert res_residency.status_code == 404
