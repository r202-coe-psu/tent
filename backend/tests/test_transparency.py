"""Tests for public transparency summary (Mongo aggregate)."""

from datetime import UTC, datetime

from httpx import AsyncClient
from pymongo import AsyncMongoClient

from apiapp.core.config import Settings


async def _insert_shelter(
    db_client: AsyncMongoClient,
    settings: Settings,
    *,
    code: str,
    status: str,
    updated_at: datetime | None = None,
    occupancy_by_status: dict[str, int] | None = None,
    is_active: bool = True,
) -> None:
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_shelters"].insert_one(
        {
            "_id": code,
            "shelter_code": code,
            "name": f"ศูนย์ {code}",
            "status": status,
            "is_active": is_active,
            "capacity": 100,
            "occupancy_by_status": occupancy_by_status or {},
            "updated_at": updated_at or datetime.now(UTC),
            "raw_data": {},
        }
    )


async def _insert_person(
    db_client: AsyncMongoClient,
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
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    # Occupancy = Forecast (CR-112) summed from each shelter's `occupancy_by_status`, which the
    # worker counts from CouchDB — including standby shelters (people still present).
    await _insert_shelter(
        db_client,
        settings,
        code="SH001",
        status="standby",
        occupancy_by_status={"active": 1, "pre_registered": 1, "kiosk_registered": 1},
    )
    await _insert_shelter(
        db_client,
        settings,
        code="SH002",
        status="open",
        occupancy_by_status={"active": 1, "cancelled": 1, "checked_out": 3},
    )
    await _insert_shelter(db_client, settings, code="SH003", status="full")
    await _insert_shelter(db_client, settings, code="SH004", status="open")

    response = await client.get("/public/v1/transparency/summary", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=60"

    body = response.json()
    assert body["summary"]["shelters_total"] == 4
    # open + full only — standby is projected but not "ready"
    assert body["summary"]["shelters_open"] == 3
    assert body["summary"]["occupancy_total"] == 4
    assert body["summary"]["vulnerable_count"] is None
    assert "last_updated" in body
    assert body["flags"]["public_metrics_occupancy"] is True


async def test_shelter_detail_counts_occupancy_on_standby(
    client: AsyncClient,
    db_client: AsyncMongoClient,
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
            "occupancy_by_status": {"active": 1},
            "raw_data": {"operation_status": "standby", "capacity": 100},
        }
    )

    response = await client.get("/public/v1/shelters/SH001", headers=auth_headers)
    assert response.status_code == 200
    shelter = response.json()["shelter"]
    assert shelter["status"] == "PREPARE"
    assert shelter["capacity"]["available"] == 99


async def test_transparency_occupancy_counts_search_excluded_people(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """PDPA D8 — opted-out / basic-consent people have no `public_persons` row but still count."""
    await _insert_shelter(
        db_client,
        settings,
        code="SH001",
        status="open",
        occupancy_by_status={"active": 2, "room_confirmed": 1},
    )
    # Only one of the three is searchable; the other two are search-excluded.
    await _insert_person(
        db_client, settings, person_id="evacuee:1", shelter_code="SH001", status="active"
    )
    # A deactivated shelter's leftover counts do not leak in.
    await _insert_shelter(
        db_client,
        settings,
        code="SH002",
        status="closed",
        is_active=False,
        occupancy_by_status={"active": 5},
    )

    response = await client.get("/public/v1/transparency/summary", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["summary"]["occupancy_total"] == 3
