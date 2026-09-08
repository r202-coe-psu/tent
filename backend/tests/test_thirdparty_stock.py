"""EXT-004 — partner stock read endpoint tests (partner ODT)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_shelter import PublicShelter
from tent_model.shelter_stock import ShelterStock

from apiapp.modules.thirdparty_auth.scopes import mint_access_token


def _bearer(scopes: list[str]) -> dict[str, str]:
    token, _ = mint_access_token(client_id="m6-test", module_name="M6", scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def stock_read_headers() -> dict[str, str]:
    return _bearer(["location-stock-read"])


@pytest.fixture
async def shelter_with_stock() -> PublicShelter:
    shelter = await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ทดสอบสต็อก",
        status="open",
        location_status="open",
        is_active=True,
        capacity=500,
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()
    await ShelterStock(
        id="SH001:item_master:water",
        shelter_code="SH001",
        item_id="item_master:water",
        m6_reference_id=5,
        m6_item_code="GEN-005",
        name_th="น้ำดื่ม 600 มล.",
        type_code="genaral",
        unit_label="ขวด",
        unit_ratio=1,
        quantity_on_hand=480,
        source="m6_transfer",
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()
    await ShelterStock(
        id="SH001:item_master:blanket",
        shelter_code="SH001",
        item_id="item_master:blanket",
        m6_reference_id=None,
        m6_item_code=None,
        name_th="ผ้าห่ม",
        type_code="genaral",
        unit_label="ผืน",
        unit_ratio=1,
        quantity_on_hand=120,
        source="direct_donation",
        updated_at=datetime(2026, 8, 11, 9, 15, 0, tzinfo=UTC),
    ).insert()
    return shelter


async def test_get_stock_requires_bearer_token(client: AsyncClient) -> None:
    response = await client.get("/api/thirdparty/locations/SH001/stock")
    assert response.status_code == 401


async def test_get_stock_rejects_insufficient_scope(client: AsyncClient) -> None:
    headers = _bearer(["location-read"])
    response = await client.get("/api/thirdparty/locations/SH001/stock", headers=headers)
    assert response.status_code == 403
    assert response.json()["code"] == "insufficient_scope"


async def test_get_stock_returns_items(
    client: AsyncClient,
    stock_read_headers: dict[str, str],
    shelter_with_stock: PublicShelter,
) -> None:
    response = await client.get("/api/thirdparty/locations/SH001/stock", headers=stock_read_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == 200
    result = body["result"]
    assert result["location_code"] == "SH001"
    items = {item["name_th"]: item for item in result["items"]}
    assert items["น้ำดื่ม 600 มล."]["quantity_on_hand"] == 480
    assert items["น้ำดื่ม 600 มล."]["m6_reference_id"] == 5
    assert items["น้ำดื่ม 600 มล."]["source"] == "m6_transfer"
    assert items["ผ้าห่ม"]["m6_reference_id"] is None
    assert items["ผ้าห่ม"]["source"] == "direct_donation"


async def test_get_stock_unknown_location_returns_location_not_found(
    client: AsyncClient, stock_read_headers: dict[str, str]
) -> None:
    response = await client.get("/api/thirdparty/locations/NOPE/stock", headers=stock_read_headers)
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "location_not_found"
    assert body["result"] == []
