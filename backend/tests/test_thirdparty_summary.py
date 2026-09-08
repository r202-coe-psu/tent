"""EXT-006 — partner cross-location summary tests (partner ODT)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_shelter import PublicShelter
from tent_model.shelter_stock import ShelterStock

from apiapp.modules.thirdparty_auth.scopes import mint_access_token


def _bearer(scopes: list[str]) -> dict[str, str]:
    token, _ = mint_access_token(client_id="m7-test", module_name="M7", scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def two_shelters() -> None:
    await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ 1",
        status="open",
        location_status="open",
        is_active=True,
        capacity=500,
        occupancy_total=312,
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()
    await PublicShelter(
        id="SH002",
        shelter_code="SH002",
        name="ศูนย์ 2",
        status="closed",
        location_status="closed",
        is_active=True,
        capacity=100,
        occupancy_total=0,
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()
    await ShelterStock(
        id="SH001:item:rice",
        shelter_code="SH001",
        item_id="item:rice",
        name_th="น้ำดื่ม 600 มล.",
        type_code="genaral",
        unit_label="ขวด",
        quantity_on_hand=480,
        reorder_threshold=100,
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()
    await ShelterStock(
        id="SH001:item:medicine",
        shelter_code="SH001",
        item_id="item:medicine",
        name_th="ยาสามัญประจำบ้าน",
        type_code="medication",
        unit_label="กล่อง",
        quantity_on_hand=4,
        reorder_threshold=100,
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()
    await ShelterStock(
        id="SH001:item:empty",
        shelter_code="SH001",
        item_id="item:empty",
        name_th="ของหมด",
        type_code="genaral",
        unit_label="ชิ้น",
        quantity_on_hand=0,
        reorder_threshold=None,
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()


async def test_get_summary_requires_bearer_token(client: AsyncClient) -> None:
    response = await client.get("/api/thirdparty/summary")
    assert response.status_code == 401


async def test_get_summary_rejects_insufficient_scope(client: AsyncClient) -> None:
    headers = _bearer(["occupancy-read"])  # missing location-read
    response = await client.get("/api/thirdparty/summary", headers=headers)
    assert response.status_code == 403
    assert response.json()["code"] == "insufficient_scope"


async def test_get_summary_omits_occupancy_total_without_occupancy_scope(
    client: AsyncClient, two_shelters: None
) -> None:
    headers = _bearer(["location-read"])
    response = await client.get("/api/thirdparty/summary", headers=headers)
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["location_count"] == 2
    assert result["capacity_total"] == 600
    assert result["occupancy_total"] is None


async def test_get_summary_includes_occupancy_total_with_occupancy_scope(
    client: AsyncClient, two_shelters: None
) -> None:
    headers = _bearer(["location-read", "occupancy-read"])
    response = await client.get("/api/thirdparty/summary", headers=headers)
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["occupancy_total"] == 312


async def test_get_summary_critical_items_only_lists_low_and_critical(
    client: AsyncClient, two_shelters: None
) -> None:
    headers = _bearer(["location-read"])
    response = await client.get("/api/thirdparty/summary", headers=headers)
    assert response.status_code == 200
    locations = {loc["location_code"]: loc for loc in response.json()["result"]["locations"]}
    critical = {item["name_th"]: item["level"] for item in locations["SH001"]["critical_items"]}
    assert critical == {"ยาสามัญประจำบ้าน": "low", "ของหมด": "critical"}
    assert "น้ำดื่ม 600 มล." not in critical  # healthy — omitted
    assert locations["SH002"]["critical_items"] == []
