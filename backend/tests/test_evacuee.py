"""Tests for evacuee public search endpoint."""

from datetime import UTC, datetime

from httpx import AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from apiapp.core.config import Settings
from apiapp.utils.masking import mask_last_name, national_id_hash, phone_hash


async def _insert_person(
    db_client: AsyncIOMotorClient,
    settings: Settings,
    doc: dict,
) -> None:
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_persons"].insert_one(doc)


async def _insert_shelter(
    db_client: AsyncIOMotorClient,
    settings: Settings,
    doc: dict,
) -> None:
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_shelters"].insert_one(doc)


async def test_evacuee_search_by_phone_returns_masked_result(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
):
    phone = "0812345678"
    now = datetime.now(UTC)
    await _insert_shelter(
        db_client,
        settings,
        {
            "_id": "SH001",
            "shelter_code": "SH001",
            "name": "ศูนย์ทดสอบ",
            "status": "open",
            "capacity": 100,
            "updated_at": now,
        },
    )
    await _insert_person(
        db_client,
        settings,
        {
            "_id": "evacuee:test1",
            "shelter_code": "SH001",
            "first_name": "สมชาย",
            "last_name_masked": mask_last_name("ใจดี"),
            "phone_hash": phone_hash(phone),
            "national_id_masked": "390-XXXX-XX-192",
            "gender": "male",
            "address_masked": "**/* ถ.นิพัทธ์อุทิศ 1 ต.หาดใหญ่ อ.หาดใหญ่ จ.สงขลา",
            "checked_in_at": datetime(2026, 5, 27, 8, 30, tzinfo=UTC),
            "care_zone": "โซนที่ General",
            "search_excluded": False,
            "status": "active",
            "updated_at": now,
        },
    )

    response = await client.post("/public/v1/family-search", json={"q": phone})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"

    body = response.json()
    assert body["count"] == 1
    result = body["results"][0]
    assert result["name"] == f"สมชาย {mask_last_name('ใจดี')}"
    assert result["status"] == "in_shelter"
    assert result["shelter_name"] == "ศูนย์ทดสอบ"
    assert result["national_id"] == "390-XXXX-XX-192"
    assert "phone" not in result


async def test_evacuee_search_by_national_id_exact_match(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
):
    national_id = "3900100244192"
    now = datetime.now(UTC)
    await _insert_shelter(
        db_client,
        settings,
        {
            "_id": "SH001",
            "shelter_code": "SH001",
            "name": "ศูนย์ทดสอบ",
            "status": "open",
            "capacity": 100,
            "updated_at": now,
        },
    )
    await _insert_person(
        db_client,
        settings,
        {
            "_id": "evacuee:test2",
            "shelter_code": "SH001",
            "first_name": "สมหญิง",
            "last_name_masked": mask_last_name("รักดี"),
            "national_id_hash": national_id_hash(national_id),
            "national_id_masked": "390-XXXX-XX-192",
            "search_excluded": False,
            "status": "transferred",
            "updated_at": now,
        },
    )

    response = await client.post(
        "/public/v1/family-search",
        json={"q": "3900-1002-4419-2"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["status"] == "moved"


async def test_evacuee_search_includes_family_members(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
):
    phone = "0811111111"
    now = datetime.now(UTC)
    await _insert_shelter(
        db_client,
        settings,
        {
            "_id": "SH001",
            "shelter_code": "SH001",
            "name": "ศูนย์ทดสอบ",
            "status": "open",
            "capacity": 100,
            "updated_at": now,
        },
    )
    for doc_id, first_name, last_name in [
        ("evacuee:parent", "พ่อ", "ใจดี"),
        ("evacuee:child", "ลูก", "ใจดี"),
    ]:
        await _insert_person(
            db_client,
            settings,
            {
                "_id": doc_id,
                "shelter_code": "SH001",
                "first_name": first_name,
                "last_name_masked": mask_last_name(last_name),
                "phone_hash": phone_hash(phone) if doc_id == "evacuee:parent" else None,
                "household_id": "household:01",
                "search_excluded": False,
                "status": "active",
                "updated_at": now,
            },
        )

    response = await client.post("/public/v1/family-search", json={"q": phone})
    assert response.status_code == 200
    members = response.json()["results"][0]["family_members"]
    assert len(members) == 1
    assert members[0]["name"] == f"ลูก {mask_last_name('ใจดี')}"


async def test_evacuee_search_hides_opted_out_records(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
):
    phone = "0899999999"
    now = datetime.now(UTC)
    await _insert_person(
        db_client,
        settings,
        {
            "_id": "evacuee:hidden",
            "shelter_code": "SH001",
            "first_name": "ซ่อน",
            "last_name_masked": mask_last_name("ตัว"),
            "phone_hash": phone_hash(phone),
            "search_excluded": True,
            "status": "active",
            "updated_at": now,
        },
    )

    response = await client.post("/public/v1/family-search", json={"q": phone})
    assert response.status_code == 200
    assert response.json()["count"] == 0


async def test_evacuee_search_rejects_invalid_query(client: AsyncClient):
    response = await client.post("/public/v1/family-search", json={"q": "ab"})
    assert response.status_code == 422


async def test_evacuee_search_writes_search_audit(
    client: AsyncClient,
    db_client: AsyncIOMotorClient,
    settings: Settings,
):
    from tent_model.search_audit import SearchAudit

    from apiapp.utils.masking import sha256_hex

    phone = "0812345670"
    now = datetime.now(UTC)
    await _insert_shelter(
        db_client,
        settings,
        {
            "_id": "SH001",
            "shelter_code": "SH001",
            "name": "ศูนย์ทดสอบ",
            "status": "open",
            "capacity": 100,
            "updated_at": now,
        },
    )
    await _insert_person(
        db_client,
        settings,
        {
            "_id": "evacuee:audit1",
            "shelter_code": "SH001",
            "first_name": "สมชาย",
            "last_name_masked": mask_last_name("ใจดี"),
            "phone_hash": phone_hash(phone),
            "search_excluded": False,
            "status": "active",
            "updated_at": now,
        },
    )

    response = await client.post(
        "/public/v1/family-search",
        json={"q": phone},
        headers={"X-Real-IP": "203.0.113.10"},
    )
    assert response.status_code == 200

    audits = await SearchAudit.find_all().to_list()
    assert len(audits) == 1
    audit = audits[0]
    assert audit.query_kind == "phone"
    assert audit.query_hash == sha256_hex(phone)
    assert audit.ip_hash == sha256_hex("203.0.113.10")
    assert audit.result_count == 1
    assert audit.synced_to_couch is False


async def test_evacuee_search_rate_limited(client: AsyncClient):
    from apiapp.modules.evacuee import router as evacuee_router

    evacuee_router._request_log.clear()
    original_max = evacuee_router.RATE_LIMIT_MAX_REQUESTS
    evacuee_router.RATE_LIMIT_MAX_REQUESTS = 3
    try:
        headers = {"X-Real-IP": "198.51.100.7"}
        for _ in range(3):
            ok = await client.post(
                "/public/v1/family-search",
                json={"q": "0811111111"},
                headers=headers,
            )
            assert ok.status_code in (200, 422)
        limited = await client.post(
            "/public/v1/family-search",
            json={"q": "0811111111"},
            headers=headers,
        )
        assert limited.status_code == 429
        assert limited.json()["detail"]["error"]["code"] == "RATE_LIMITED"
    finally:
        evacuee_router.RATE_LIMIT_MAX_REQUESTS = original_max
        evacuee_router._request_log.clear()
