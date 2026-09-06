"""EXT-005 — partner occupancy read endpoint tests (partner ODT)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_shelter import OccupancyBreakdown, PublicShelter

from apiapp.modules.thirdparty_auth.scopes import mint_access_token


def _bearer(scopes: list[str]) -> dict[str, str]:
    token, _ = mint_access_token(client_id="m7-test", module_name="M7", scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def occupancy_read_headers() -> dict[str, str]:
    return _bearer(["occupancy-read"])


@pytest.fixture
async def shelter_with_occupancy() -> PublicShelter:
    return await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ทดสอบ occupancy",
        status="open",
        location_status="open",
        is_active=True,
        capacity=500,
        occupancy_total=312,
        occupancy_breakdown=OccupancyBreakdown(
            male=141,
            female=171,
            child_under_5=24,
            elderly_over_60=58,
            pregnant=3,
            bedridden=6,
            disabled=11,
        ),
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()


async def test_get_occupancy_requires_bearer_token(client: AsyncClient) -> None:
    response = await client.get("/api/thirdparty/locations/SH001/occupancy")
    assert response.status_code == 401


async def test_get_occupancy_rejects_insufficient_scope(client: AsyncClient) -> None:
    headers = _bearer(["location-read"])
    response = await client.get("/api/thirdparty/locations/SH001/occupancy", headers=headers)
    assert response.status_code == 403
    assert response.json()["code"] == "insufficient_scope"


async def test_get_occupancy_returns_total_and_breakdown(
    client: AsyncClient,
    occupancy_read_headers: dict[str, str],
    shelter_with_occupancy: PublicShelter,
) -> None:
    response = await client.get(
        "/api/thirdparty/locations/SH001/occupancy", headers=occupancy_read_headers
    )
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["capacity"] == 500
    assert result["occupancy_total"] == 312
    assert result["breakdown"] == {
        "male": 141,
        "female": 171,
        "child_under_5": 24,
        "elderly_over_60": 58,
        "pregnant": 3,
        "bedridden": 6,
        "disabled": 11,
    }
    assert result["updated_by_role"]


async def test_get_occupancy_unknown_location_returns_location_not_found(
    client: AsyncClient, occupancy_read_headers: dict[str, str]
) -> None:
    response = await client.get(
        "/api/thirdparty/locations/NOPE/occupancy", headers=occupancy_read_headers
    )
    assert response.status_code == 404
    assert response.json()["code"] == "location_not_found"
