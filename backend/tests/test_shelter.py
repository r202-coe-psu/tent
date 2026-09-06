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


async def test_list_shelters_filters_by_site_kind(
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
            "name": "ศูนย์ทดสอบ",
            "site_kind": "evacuation_center",
            "status": "open",
            "capacity": 100,
            "updated_at": now,
        },
    )
    await _insert_shelter_doc(
        db_client,
        settings,
        {
            "_id": "SH002",
            "shelter_code": "SH002",
            "name": "บ้านทดสอบ",
            "site_kind": "host_house",
            "status": "open",
            "capacity": 10,
            "updated_at": now,
        },
    )

    response = await client.get(
        "/public/v1/shelters",
        params={"site_kind": "host_house"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["shelters"][0]["site_kind"] == "host_house"


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


async def _insert_person_doc(
    db_client: AsyncIOMotorClient,
    settings: Settings,
    person_id: str,
    shelter_code: str,
    status: str,
) -> None:
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_persons"].insert_one(
        {
            "_id": person_id,
            "shelter_code": shelter_code,
            "first_name": "ทดสอบ",
            "last_name_masked": "ท.",
            "status": status,
            "search_excluded": False,
            "updated_at": datetime.now(UTC),
        }
    )


async def test_shelter_detail_occupancy_counts_pre_registered(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """CR-112 — public `occupancy` is Forecast; `present` / `in_zone` are additive."""
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
            "raw_data": {"operation_status": "active", "capacity": 100},
        },
    )

    for idx, status in enumerate(["active", "active", "active"]):
        await _insert_person_doc(db_client, settings, f"evacuee:a{idx}", "SH001", status)
    for idx, status in enumerate(["pre_registered", "pre_registered"]):
        await _insert_person_doc(db_client, settings, f"evacuee:p{idx}", "SH001", status)
    await _insert_person_doc(db_client, settings, "evacuee:arr0", "SH001", "arriving")
    await _insert_person_doc(db_client, settings, "evacuee:rc0", "SH001", "room_confirmed")
    await _insert_person_doc(db_client, settings, "evacuee:tl0", "SH001", "temporary_leave")
    # Terminal statuses do not hold a Forecast seat.
    await _insert_person_doc(db_client, settings, "evacuee:c0", "SH001", "cancelled")
    await _insert_person_doc(db_client, settings, "evacuee:o0", "SH001", "checked_out")
    # Another shelter's residents must not leak in.
    await _insert_person_doc(db_client, settings, "evacuee:x0", "SH002", "active")

    response = await client.get("/public/v1/shelters/SH001", headers=auth_headers)
    assert response.status_code == 200

    shelter = response.json()["shelter"]
    # Forecast: 3 active + 2 pre_registered + 1 arriving + 1 room_confirmed + 1 temporary_leave = 8
    assert shelter["occupancy"] == 8
    # Present: 3 active + 1 room_confirmed + 1 temporary_leave = 5
    assert shelter["present"] == 5
    # In-zone: room_confirmed only
    assert shelter["in_zone"] == 1
    assert shelter["capacity"]["total"] == 100
    assert shelter["capacity"]["available"] == 92
    assert shelter["occupancy_rate"] == 8
