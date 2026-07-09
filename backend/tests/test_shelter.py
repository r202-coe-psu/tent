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


async def test_list_shelters_returns_open_shelters(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
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

    response = await client.get("/public/v1/shelter")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=600"

    body = response.json()
    assert body["count"] == 2
    assert len(body["shelters"]) == 2
    assert body["shelters"][0]["code"] == "SH001"
    assert body["shelters"][0]["geo"]["lat"] == 7.0


async def test_list_shelters_filters_by_province(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
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

    response = await client.get("/public/v1/shelter", params={"province": "สงขลา"})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["shelters"][0]["code"] == "SH001"
