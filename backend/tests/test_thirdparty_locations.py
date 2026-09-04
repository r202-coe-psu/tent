"""EXT-002/003 — partner Location Master read endpoint tests (partner ODT)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from tent_model.public_shelter import GeoPoint, PublicShelter

from apiapp.modules.thirdparty_auth.scopes import mint_access_token


def _bearer(scopes: list[str]) -> dict[str, str]:
    token, _ = mint_access_token(client_id="m6-test", module_name="M6", scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def location_read_headers() -> dict[str, str]:
    return _bearer(["location-read"])


@pytest.fixture
async def open_hatyai_shelter() -> PublicShelter:
    doc = PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์พักพิงโรงเรียนหาดใหญ่วิทยาลัย",
        name_short="รร.หาดใหญ่วิทยาลัย",
        status="open",
        location_status="open",
        is_active=True,
        location_type="shelter",
        location_subtype="school",
        capacity=500,
        geo=GeoPoint(lat=7.008612, lng=100.474733),
        province="สงขลา",
        district="หาดใหญ่",
        subdistrict="คอหงส์",
        address="ถนนเพชรเกษม ต.หาดใหญ่ อ.หาดใหญ่ จ.สงขลา",
        contact_name="หัวหน้าศูนย์พักพิง",
        contact_phone="074-000000",
        accepts_delivery=True,
        opened_at=datetime(2026, 8, 9, 6, 0, 0, tzinfo=UTC),
        raw_data={
            "facilities": {"toilets_female": 6, "toilets_male": 6, "showers": 4},
            "common_areas": {"central_kitchen": True, "isolation_room": True},
            "utilities": {"power_source": "generator"},
        },
        updated_at=datetime.now(UTC),
    )
    await doc.insert()
    return doc


@pytest.fixture
async def closed_shelter() -> PublicShelter:
    """Soft-retained closed shelter — Operational Status only, `is_active` untouched."""
    doc = PublicShelter(
        id="SH002",
        shelter_code="SH002",
        name="ศูนย์ปิดแล้ว",
        status="closed",
        location_status="closed",
        is_active=True,
        capacity=50,
        updated_at=datetime.now(UTC),
    )
    await doc.insert()
    return doc


@pytest.fixture
async def deactivated_shelter() -> PublicShelter:
    """True archive/delete signal — `is_active: false`, row still present (never hard-deleted)."""
    doc = PublicShelter(
        id="SH003",
        shelter_code="SH003",
        name="ศูนย์ที่ถูกยกเลิกถาวร",
        status="closed",
        location_status="closed",
        is_active=False,
        capacity=30,
        updated_at=datetime.now(UTC),
    )
    await doc.insert()
    return doc


async def test_list_locations_requires_bearer_token(client: AsyncClient) -> None:
    response = await client.get("/api/thirdparty/locations")
    assert response.status_code == 401
    body = response.json()
    assert body["status"] == 401
    assert body["code"] == "invalid_token"


async def test_list_locations_rejects_insufficient_scope(client: AsyncClient) -> None:
    headers = _bearer(["occupancy-read"])
    response = await client.get("/api/thirdparty/locations", headers=headers)
    assert response.status_code == 403
    body = response.json()
    assert body["status"] == 403
    assert body["code"] == "insufficient_scope"


async def test_list_locations_excludes_inactive_by_default(
    client: AsyncClient,
    location_read_headers: dict[str, str],
    open_hatyai_shelter: PublicShelter,
    closed_shelter: PublicShelter,
    deactivated_shelter: PublicShelter,
) -> None:
    response = await client.get("/api/thirdparty/locations", headers=location_read_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == 200
    assert body["message"] == "Found Data."
    codes = {item["location_code"] for item in body["result"]}
    # Closed-but-active stays in the default view; only is_active=false is excluded.
    assert codes == {"SH001", "SH002"}


async def test_list_locations_include_inactive_true_includes_deactivated(
    client: AsyncClient,
    location_read_headers: dict[str, str],
    open_hatyai_shelter: PublicShelter,
    deactivated_shelter: PublicShelter,
) -> None:
    response = await client.get(
        "/api/thirdparty/locations",
        headers=location_read_headers,
        params={"include_inactive": "true"},
    )
    assert response.status_code == 200
    codes = {item["location_code"] for item in response.json()["result"]}
    assert codes == {"SH001", "SH003"}


async def test_list_locations_filters_by_status(
    client: AsyncClient,
    location_read_headers: dict[str, str],
    open_hatyai_shelter: PublicShelter,
    closed_shelter: PublicShelter,
) -> None:
    response = await client.get(
        "/api/thirdparty/locations",
        headers=location_read_headers,
        params={"status": "closed"},
    )
    assert response.status_code == 200
    codes = {item["location_code"] for item in response.json()["result"]}
    assert codes == {"SH002"}


async def test_list_locations_filters_by_updated_since(
    client: AsyncClient,
    location_read_headers: dict[str, str],
    open_hatyai_shelter: PublicShelter,
) -> None:
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    response = await client.get(
        "/api/thirdparty/locations",
        headers=location_read_headers,
        params={"updated_since": future},
    )
    assert response.status_code == 200
    assert response.json()["result"] == []


async def test_get_location_returns_full_fields_and_dopa_codes(
    client: AsyncClient,
    location_read_headers: dict[str, str],
    open_hatyai_shelter: PublicShelter,
) -> None:
    response = await client.get("/api/thirdparty/locations/SH001", headers=location_read_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == 200
    result = body["result"]
    assert result["location_code"] == "SH001"
    assert result["name_th"] == "ศูนย์พักพิงโรงเรียนหาดใหญ่วิทยาลัย"
    assert result["name_short"] == "รร.หาดใหญ่วิทยาลัย"
    assert result["location_type"] == "shelter"
    assert result["location_subtype"] == "school"
    assert result["location_status"] == "open"
    assert result["latitude"] == pytest.approx(7.008612)
    assert result["longitude"] == pytest.approx(100.474733)
    assert result["subdistrict_code"] == "900704"
    assert result["district_code"] == "9007"
    assert result["province_code"] == "90"
    assert result["contact_name"] == "หัวหน้าศูนย์พักพิง"
    assert result["contact_phone"] == "074-000000"
    assert result["accepts_delivery"] is True
    assert result["is_active"] is True
    assert result["occupancy_total"] == 0
    assert "ห้องน้ำ 12 ห้อง" in result["facilities"]
    assert "ครัวกลาง" in result["facilities"]
    assert "ไฟฟ้าสำรอง (เครื่องปั่นไฟ)" in result["facilities"]


async def test_get_location_returns_null_dopa_codes_when_unmapped(
    client: AsyncClient, location_read_headers: dict[str, str], closed_shelter: PublicShelter
) -> None:
    response = await client.get("/api/thirdparty/locations/SH002", headers=location_read_headers)
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["province_code"] is None
    assert result["district_code"] is None
    assert result["subdistrict_code"] is None
    assert result["facilities"] == []


async def test_get_location_unknown_code_returns_location_not_found(
    client: AsyncClient, location_read_headers: dict[str, str]
) -> None:
    response = await client.get("/api/thirdparty/locations/NOPE", headers=location_read_headers)
    assert response.status_code == 404
    body = response.json()
    assert body["status"] == 404
    assert body["code"] == "location_not_found"
    assert body["result"] == []
