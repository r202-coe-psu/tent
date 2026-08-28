"""Tests for public transparency summary (Mongo aggregate)."""

from datetime import UTC, datetime

from httpx import AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from apiapp.core.config import Settings


async def _insert_shelter(
    db_client: AsyncIOMotorClient,
    settings: Settings,
    *,
    code: str,
    status: str,
    updated_at: datetime | None = None,
) -> None:
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_shelters"].insert_one(
        {
            "_id": code,
            "shelter_code": code,
            "name": f"ศูนย์ {code}",
            "status": status,
            "capacity": 100,
            "updated_at": updated_at or datetime.now(UTC),
            "raw_data": {},
        }
    )


async def _insert_person(
    db_client: AsyncIOMotorClient,
    settings: Settings,
    *,
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


async def test_transparency_summary_requires_bearer(client: AsyncClient):
    response = await client.get("/public/v1/transparency/summary")
    assert response.status_code == 401


async def test_transparency_summary_aggregates_mongo(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    await _insert_shelter(db_client, settings, code="SH001", status="standby")
    await _insert_shelter(db_client, settings, code="SH002", status="open")
    await _insert_shelter(db_client, settings, code="SH003", status="full")
    await _insert_shelter(db_client, settings, code="SH004", status="open")

    # Occupancy counts active + pre_registered across all projected shelters,
    # including standby (people still present).
    await _insert_person(
        db_client, settings, person_id="evacuee:1", shelter_code="SH001", status="active"
    )
    await _insert_person(
        db_client,
        settings,
        person_id="evacuee:2",
        shelter_code="SH001",
        status="pre_registered",
    )
    await _insert_person(
        db_client, settings, person_id="evacuee:3", shelter_code="SH002", status="active"
    )
    await _insert_person(
        db_client, settings, person_id="evacuee:4", shelter_code="SH002", status="cancelled"
    )

    response = await client.get("/public/v1/transparency/summary", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=60"

    body = response.json()
    assert body["summary"]["shelters_total"] == 4
    # open + full only — standby is projected but not "ready"
    assert body["summary"]["shelters_open"] == 3
    assert body["summary"]["occupancy_total"] == 3
    assert body["summary"]["vulnerable_count"] is None
    assert "last_updated" in body
    assert body["flags"]["public_metrics_occupancy"] is True


async def test_shelter_detail_counts_occupancy_on_standby(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    now = datetime.now(UTC)
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_shelters"].insert_one(
        {
            "_id": "SH001",
            "shelter_code": "SH001",
            "name": "ศูนย์สแตนด์บาย",
            "status": "standby",
            "capacity": 100,
            "updated_at": now,
            "raw_data": {"operation_status": "standby", "capacity": 100},
        }
    )
    await _insert_person(
        db_client, settings, person_id="evacuee:s1", shelter_code="SH001", status="active"
    )

    response = await client.get("/public/v1/shelters/SH001", headers=auth_headers)
    assert response.status_code == 200
    shelter = response.json()["shelter"]
    assert shelter["status"] == "PREPARE"
    assert shelter["capacity"]["available"] == 99
