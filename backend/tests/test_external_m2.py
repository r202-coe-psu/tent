"""Tests for M2 External API integration (Endpoints 1 and 3)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient
from tent_model.api_key import ApiKey
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import GeoPoint, PublicShelter

from apiapp.core.config import Settings
from apiapp.utils.masking import national_id_hash, sha256_hex
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
    res_bearer = await client.get("/external/v1/shelters", headers=bearer_headers)
    assert res_bearer.status_code == 200

    # 2. X-API-Key
    res_x_key = await client.get("/external/v1/shelters", headers=x_api_key_headers)
    assert res_x_key.status_code == 200

    # 3. Missing Auth
    res_missing = await client.get("/external/v1/shelters")
    assert res_missing.status_code == 401
    assert res_missing.json()["error"]["code"] == "unauthorized"

    # 4. Invalid Token
    res_invalid = await client.get(
        "/external/v1/shelters",
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
        "/external/v1/shelters",
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
        "/external/v1/shelters",
        headers={"Authorization": f"Bearer {rev_plain}"},
    )
    assert res_rev.status_code == 401
    assert res_rev.json()["error"]["code"] == "unauthorized"
    assert "revoked" in res_rev.json()["error"]["message"]


async def test_get_shelters_list_and_filter(
    client: AsyncClient,
    valid_api_key: ApiKey,
    bearer_headers: dict[str, str],
    sample_shelters: list[PublicShelter],
) -> None:
    # List all shelters
    res = await client.get("/external/v1/shelters", headers=bearer_headers)
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body, list)
    assert len(body) == 2

    # Check fields of SH001
    sh001 = next(s for s in body if s["shelter_id"] == "SH001")
    assert sh001["shelter_name"] == "ศูนย์พักพิงเทศบาล 1"
    assert sh001["lat"] == 7.0084
    assert sh001["long"] == 100.4767

    # Check fields of SH002 (no geo)
    sh002 = next(s for s in body if s["shelter_id"] == "SH002")
    assert sh002["shelter_name"] == "ศูนย์พักพิงโรงเรียน 2"
    assert sh002["lat"] is None
    assert sh002["long"] is None

    # Filter status=open
    res_open = await client.get(
        "/external/v1/shelters",
        params={"status": "open"},
        headers=bearer_headers,
    )
    assert res_open.status_code == 200
    body_open = res_open.json()
    assert len(body_open) == 1
    assert body_open[0]["shelter_id"] == "SH001"


async def test_get_person_shelter_residency_active(
    client: AsyncClient,
    valid_api_key: ApiKey,
    bearer_headers: dict[str, str],
    sample_shelters: list[PublicShelter],
) -> None:
    cid = "1234567890123"
    checkin_time = datetime(2026, 8, 20, 7, 30, 0, tzinfo=UTC)  # 14:30 Bangkok time (+07:00)

    person = PublicPerson(
        id="evacuee:01HTESTPERSON001",
        shelter_code="SH001",
        first_name="สมชาย",
        last_name_masked="ใ***",
        national_id_hash=national_id_hash(cid),
        status="active",
        checked_in_at=checkin_time,
        updated_at=datetime.now(UTC),
    )
    await person.insert()

    res = await client.get(
        "/external/v1/persons/shelter-residency",
        params={"cid": cid},
        headers=bearer_headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["shelter_id"] == "SH001"
    assert body["shelter_name"] == "ศูนย์พักพิงเทศบาล 1"
    assert body["status"] == "CHECKED_IN"
    assert body["checkin_datetime"] == "2026-08-20T14:30:00+07:00"


async def test_get_person_shelter_residency_checked_out(
    client: AsyncClient,
    valid_api_key: ApiKey,
    bearer_headers: dict[str, str],
    sample_shelters: list[PublicShelter],
) -> None:
    cid = "9876543210987"
    checkin_time = datetime(2026, 8, 15, 2, 0, 0, tzinfo=UTC)  # 09:00 Bangkok time

    person = PublicPerson(
        id="evacuee:01HTESTPERSON002",
        shelter_code="SH001",
        first_name="สมหญิง",
        last_name_masked="ส***",
        national_id_hash=national_id_hash(cid),
        status="checked_out",
        checked_in_at=checkin_time,
        updated_at=datetime.now(UTC),
    )
    await person.insert()

    res = await client.get(
        "/external/v1/persons/shelter-residency",
        params={"cid": cid},
        headers=bearer_headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["shelter_id"] == "SH001"
    assert body["shelter_name"] == "ศูนย์พักพิงเทศบาล 1"
    assert body["status"] == "CHECKED_OUT"
    assert body["checkin_datetime"] == "2026-08-15T09:00:00+07:00"


async def test_get_person_shelter_residency_pre_registered_returns_404(
    client: AsyncClient,
    valid_api_key: ApiKey,
    bearer_headers: dict[str, str],
    sample_shelters: list[PublicShelter],
) -> None:
    cid = "1111222233334"
    person = PublicPerson(
        id="evacuee:01HTESTPERSON003",
        shelter_code="SH001",
        first_name="ผู้จอง",
        last_name_masked="ย***",
        national_id_hash=national_id_hash(cid),
        status="pre_registered",
        checked_in_at=None,
        updated_at=datetime.now(UTC),
    )
    await person.insert()

    res = await client.get(
        "/external/v1/persons/shelter-residency",
        params={"cid": cid},
        headers=bearer_headers,
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


async def test_get_person_shelter_residency_not_found(
    client: AsyncClient,
    valid_api_key: ApiKey,
    bearer_headers: dict[str, str],
) -> None:
    res = await client.get(
        "/external/v1/persons/shelter-residency",
        params={"cid": "0000000000000"},
        headers=bearer_headers,
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


async def test_get_person_shelter_residency_validation_error(
    client: AsyncClient,
    valid_api_key: ApiKey,
    bearer_headers: dict[str, str],
) -> None:
    # Less than 13 digits
    res_short = await client.get(
        "/external/v1/persons/shelter-residency",
        params={"cid": "12345"},
        headers=bearer_headers,
    )
    assert res_short.status_code == 422
    assert res_short.json()["error"]["code"] == "validation_error"

    # Non-digits
    res_alpha = await client.get(
        "/external/v1/persons/shelter-residency",
        params={"cid": "1234567890abc"},
        headers=bearer_headers,
    )
    assert res_alpha.status_code == 422
    assert res_alpha.json()["error"]["code"] == "validation_error"
