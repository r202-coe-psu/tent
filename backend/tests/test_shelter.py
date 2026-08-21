"""Tests for shelter public list endpoint."""

from datetime import UTC, datetime

from httpx import AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from apiapp.core.config import Settings


async def _insert_shelter_doc(
    db_client: AsyncIOMotorClient,
    settings: Settings,
    doc: dict,
) -> None:
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_shelters"].insert_one(doc)


async def test_list_shelters_requires_bearer(client: AsyncClient):
    response = await client.get("/public/v1/shelters")
    assert response.status_code == 401


async def test_list_shelters_returns_open_shelters(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    now = datetime.now(UTC)
    await _insert_shelter_doc(
        db_client,
        settings,
        {
            "_id": "SH001",
            "shelter_code": "SH001",
            "name": "ศูนย์ทดสอบ 1",
            "status": "open",
            "capacity": 100,
            "geo": {"lat": 7.0, "lng": 100.5},
            "location": {"type": "Point", "coordinates": [100.5, 7.0]},
            "province": "สงขลา",
            "district": "หาดใหญ่",
            "subdistrict": "หาดใหญ่",
            "updated_at": now,
        },
    )
    await _insert_shelter_doc(
        db_client,
        settings,
        {
            "_id": "SH002",
            "shelter_code": "SH002",
            "name": "ศูนย์ทดสอบ 2",
            "status": "open",
            "capacity": 50,
            "province": "กรุงเทพมหานคร",
            "district": "บางรัก",
            "subdistrict": "สีลม",
            "updated_at": now,
        },
    )

    response = await client.get("/public/v1/shelters", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=600"

    body = response.json()
    assert body["count"] == 2
    assert len(body["shelters"]) == 2
    assert body["shelters"][0]["code"] == "SH001"
    assert body["shelters"][0]["geo"]["lat"] == 7.0
    assert body["shelters"][0]["location"]["coordinates"] == [100.5, 7.0]


async def test_list_shelters_filters_by_province(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    now = datetime.now(UTC)
    await _insert_shelter_doc(
        db_client,
        settings,
        {
            "_id": "SH001",
            "shelter_code": "SH001",
            "name": "ศูนย์ทดสอบ 1",
            "status": "open",
            "capacity": 100,
            "province": "สงขลา",
            "updated_at": now,
        },
    )
    await _insert_shelter_doc(
        db_client,
        settings,
        {
            "_id": "SH002",
            "shelter_code": "SH002",
            "name": "ศูนย์ทดสอบ 2",
            "status": "open",
            "capacity": 50,
            "province": "กรุงเทพมหานคร",
            "updated_at": now,
        },
    )

    response = await client.get(
        "/public/v1/shelters",
        params={"province": "สงขลา"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["shelters"][0]["code"] == "SH001"


async def test_list_shelters_filters_by_radius(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    # Ensure 2dsphere index exists on public_shelters collection
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_shelters"].create_index([("location", "2dsphere")])

    now = datetime.now(UTC)
    # SH001 in Hat Yai, Songkhla (~7.0, 100.5)
    await _insert_shelter_doc(
        db_client,
        settings,
        {
            "_id": "SH001",
            "shelter_code": "SH001",
            "name": "ศูนย์หาดใหญ่",
            "status": "open",
            "capacity": 100,
            "geo": {"lat": 7.0, "lng": 100.5},
            "location": {"type": "Point", "coordinates": [100.5, 7.0]},
            "province": "สงขลา",
            "district": "หาดใหญ่",
            "updated_at": now,
        },
    )
    # SH002 in Bangkok (~13.75, 100.5) ~750km away
    await _insert_shelter_doc(
        db_client,
        settings,
        {
            "_id": "SH002",
            "shelter_code": "SH002",
            "name": "ศูนย์กรุงเทพ",
            "status": "open",
            "capacity": 50,
            "geo": {"lat": 13.75, "lng": 100.5},
            "location": {"type": "Point", "coordinates": [100.5, 13.75]},
            "province": "กรุงเทพมหานคร",
            "district": "บางรัก",
            "updated_at": now,
        },
    )

    # Search within 50 km of Hat Yai (lat=7.0, lng=100.5) -> only SH001
    resp_50km = await client.get(
        "/public/v1/shelters",
        params={"lat": 7.0, "lng": 100.5, "radius_km": 50},
        headers=auth_headers,
    )
    assert resp_50km.status_code == 200
    body_50km = resp_50km.json()
    assert body_50km["count"] == 1
    assert body_50km["shelters"][0]["code"] == "SH001"

    # Search within 1000 km of Hat Yai -> both SH001 and SH002
    resp_1000km = await client.get(
        "/public/v1/shelters",
        params={"lat": 7.0, "lng": 100.5, "radius_km": 1000},
        headers=auth_headers,
    )
    assert resp_1000km.status_code == 200
    body_1000km = resp_1000km.json()
    assert body_1000km["count"] == 2
    # SH001 is closest, so it should be first
    assert body_1000km["shelters"][0]["code"] == "SH001"

