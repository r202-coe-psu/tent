"""EXT-007 — partner occupant-detail scaffold tests (partner ODT, ADR 0002 §6)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from apiapp.modules.thirdparty_auth.scopes import mint_access_token


def _bearer(scopes: list[str]) -> dict[str, str]:
    token, _ = mint_access_token(client_id="m7-test", module_name="M7", scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def shelter() -> PublicShelter:
    return await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ทดสอบ",
        status="open",
        location_status="open",
        is_active=True,
        capacity=100,
        updated_at=datetime.now(UTC),
    ).insert()


async def test_get_occupants_requires_bearer_token(client: AsyncClient) -> None:
    response = await client.get(
        "/api/thirdparty/locations/SH001/occupants", params={"purpose": "medical-referral"}
    )
    assert response.status_code == 401


async def test_get_occupants_missing_purpose_returns_400(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    headers = _bearer([])
    response = await client.get("/api/thirdparty/locations/SH001/occupants", headers=headers)
    assert response.status_code == 400
    body = response.json()
    assert body["status"] == 400
    assert body["code"] == "missing_purpose"


async def test_get_occupants_denied_by_default(client: AsyncClient, shelter: PublicShelter) -> None:
    """ODT: every module defaults to no `occupancy-pii-read` — always 403 today."""
    headers = _bearer(["location-read", "occupancy-read"])  # no occupancy-pii-read
    response = await client.get(
        "/api/thirdparty/locations/SH001/occupants",
        headers=headers,
        params={"purpose": "medical-referral"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["status"] == 403
    assert body["code"] == "insufficient_scope"
    assert "detail" in body


async def test_get_occupants_denial_persists_access_log_row(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    headers = _bearer([])
    response = await client.get(
        "/api/thirdparty/locations/SH001/occupants",
        headers=headers,
        params={"purpose": "medical-referral"},
    )
    assert response.status_code == 403

    rows = await ThirdPartyAccessLog.find(ThirdPartyAccessLog.location_code == "SH001").to_list()
    assert len(rows) == 1
    row = rows[0]
    assert row.client_id == "m7-test"
    assert row.module_name == "M7"
    assert row.endpoint == "EXT-007"
    assert row.purpose == "medical-referral"
    assert row.status == "denied_insufficient_scope"
    assert row.ip


async def test_get_occupants_missing_purpose_also_logs_the_attempt(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    headers = _bearer([])
    await client.get("/api/thirdparty/locations/SH001/occupants", headers=headers)

    rows = await ThirdPartyAccessLog.find(ThirdPartyAccessLog.location_code == "SH001").to_list()
    assert len(rows) == 1
    assert rows[0].status == "denied_missing_purpose"
    assert rows[0].purpose == ""


async def test_get_occupants_never_returns_pii_even_with_scope_granted(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    """Out of Scope (CR-109/ext-spec.md): no real payload, even if a token somehow
    carries `occupancy-pii-read` — the data source itself isn't built in this slice."""
    headers = _bearer(["occupancy-pii-read"])
    response = await client.get(
        "/api/thirdparty/locations/SH001/occupants",
        headers=headers,
        params={"purpose": "medical-referral"},
    )
    assert response.status_code == 200
    assert response.json()["result"] == []

    rows = await ThirdPartyAccessLog.find(ThirdPartyAccessLog.location_code == "SH001").to_list()
    assert rows[0].status == "granted_no_data_source"
