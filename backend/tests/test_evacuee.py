"""Tests for evacuee public search endpoint."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from pymongo import AsyncMongoClient
from tent_model.api_key import ApiKey

from apiapp.core.config import Settings
from apiapp.modules.evacuee.use_case import map_public_status
from apiapp.utils.masking import (
    last_name_hash,
    mask_last_name,
    name_key,
    national_id_hash,
    passport_hash,
    phone_hash,
    sha256_hex,
)
from apiapp.utils.ulid import new_ulid


def test_map_public_status_includes_arriving_and_room_confirmed():
    """CR-112 — public search allow-list includes Report-in and Zone Arrival."""
    assert map_public_status("arriving") == "arriving"
    assert map_public_status("room_confirmed") == "room_confirmed"
    assert map_public_status("kiosk_registered") == "kiosk_registered"
    assert map_public_status("active") == "active"
    assert map_public_status("teleported") == "unknown"


async def _insert_person(
    db_client: AsyncMongoClient,
    settings: Settings,
    doc: dict,
    *,
    last_name: str | None = None,
) -> None:
    """Insert a `public_persons` row the way the worker projects it (CR-166 keys included).

    `last_name` is the full surname the worker would hash; it is never stored.
    """
    doc = {
        "first_name_key": name_key(doc.get("first_name", "")),
        "last_name_hash": last_name_hash(last_name),
        **doc,
    }
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_persons"].insert_one(doc)


async def _insert_shelter(
    db_client: AsyncMongoClient,
    settings: Settings,
    doc: dict,
) -> None:
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_shelters"].insert_one(doc)


async def test_evacuee_search_by_phone_returns_masked_result(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
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

    response = await client.post(
        "/public/v1/occupants",
        json={"q": phone},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"

    body = response.json()
    assert body["count"] == 1
    result = body["results"][0]
    assert result["name"] == f"สมชาย {mask_last_name('ใจดี')}"
    # CR-080: the real stay status, not the old collapsed `in_shelter` bucket.
    assert result["status"] == "active"
    assert result["shelter_name"] == "ศูนย์ทดสอบ"
    assert result["national_id"] == "390-XXXX-XX-192"
    assert "phone" not in result


async def test_evacuee_search_by_national_id_exact_match(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
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
        "/public/v1/occupants",
        json={"q": "3900-1002-4419-2"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["status"] == "transferred"


async def test_evacuee_search_includes_family_members(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
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

    response = await client.post(
        "/public/v1/occupants",
        json={"q": phone},
        headers=auth_headers,
    )
    assert response.status_code == 200
    members = response.json()["results"][0]["family_members"]
    assert len(members) == 1
    assert members[0]["name"] == f"ลูก {mask_last_name('ใจดี')}"
    assert members[0]["status"] == "active"


async def test_evacuee_search_reports_pre_registered_as_itself(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """CR-080 — the case the old three-bucket mapping got wrong.

    Someone who booked online (CR-070) and has not arrived is `pre_registered`.
    The public search used to fold that into `in_shelter`, telling a relative the
    person was safely at the shelter when nobody had seen them.
    """
    phone = "0822222222"
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
            "_id": "evacuee:booked",
            "shelter_code": "SH001",
            "first_name": "สมปอง",
            "last_name_masked": mask_last_name("ยังไม่มา"),
            "phone_hash": phone_hash(phone),
            "search_excluded": False,
            "status": "pre_registered",
            "updated_at": now,
        },
    )

    response = await client.post(
        "/public/v1/occupants",
        json={"q": phone},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "pre_registered"


async def test_evacuee_search_reports_unmapped_status_as_unknown(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """A projection emitting a status the API has not been taught must not be
    guessed at — `unknown` says so plainly instead of picking an outcome."""
    phone = "0833333333"
    now = datetime.now(UTC)
    await _insert_person(
        db_client,
        settings,
        {
            "_id": "evacuee:weird",
            "shelter_code": "SH001",
            "first_name": "สมศรี",
            "last_name_masked": mask_last_name("แปลก"),
            "phone_hash": phone_hash(phone),
            "search_excluded": False,
            "status": "teleported",
            "updated_at": now,
        },
    )

    response = await client.post(
        "/public/v1/occupants",
        json={"q": phone},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "unknown"


async def test_evacuee_search_matches_a_thai_name_prefix(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """Thai is one token to MongoDB's text index, so partial names need the
    prefix fallback — "สัก" found nothing before it existed (CR-080)."""
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
            "_id": "evacuee:thai",
            "shelter_code": "SH001",
            "first_name": "สักก์ธนัชญ์",
            "last_name_masked": mask_last_name("พีระพันธ์"),
            "search_excluded": False,
            "status": "active",
            "updated_at": now,
        },
    )

    partial = await client.post(
        "/public/v1/occupants",
        json={"q": "สักก์"},
        headers=auth_headers,
    )
    assert partial.status_code == 200
    assert partial.json()["count"] == 1

    # Still exact-matchable, and still not a browse-everyone oracle: the regex is
    # anchored, so a fragment from the middle of the name matches nothing.
    exact = await client.post(
        "/public/v1/occupants",
        json={"q": "สักก์ธนัชญ์"},
        headers=auth_headers,
    )
    assert exact.json()["count"] == 1

    middle = await client.post(
        "/public/v1/occupants",
        json={"q": "ธนัชญ์"},
        headers=auth_headers,
    )
    assert middle.json()["count"] == 0


async def test_evacuee_search_hides_opted_out_records(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
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

    response = await client.post(
        "/public/v1/occupants",
        json={"q": phone},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 0


async def test_evacuee_search_rejects_invalid_query(
    client: AsyncClient, auth_headers: dict[str, str]
):
    response = await client.post(
        "/public/v1/occupants",
        json={"q": "a"},
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_evacuee_search_rejects_a_query_with_a_one_character_word(
    client: AsyncClient, auth_headers: dict[str, str]
):
    """CR-166 — each word is judged on its own; "ก ข" used to pass as 3 characters."""
    for query in ("ก ข", "สมหมาย ก", "ก สมหมาย"):
        response = await client.post(
            "/public/v1/occupants",
            json={"q": query},
            headers=auth_headers,
        )
        assert response.status_code == 422, query


async def test_evacuee_search_rejects_more_than_four_words(
    client: AsyncClient, auth_headers: dict[str, str]
):
    response = await client.post(
        "/public/v1/occupants",
        json={"q": "สม หมาย มี โชค ดี"},
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_evacuee_search_writes_search_audit(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
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
        "/public/v1/occupants",
        json={"q": phone},
        headers={**auth_headers, "X-Real-IP": "203.0.113.10"},
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


async def test_evacuee_search_returns_shelter_address_and_no_zone_keys(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    phone = "0899999999"
    now = datetime.now(UTC)
    await _insert_shelter(
        db_client,
        settings,
        {
            "_id": "SH002",
            "shelter_code": "SH002",
            "name": "ศูนย์โรงเรียนอนุบาลแม่สาย",
            "address": "123 หมู่ 4 ต.แม่สาย อ.แม่สาย จ.เชียงราย",
            "status": "open",
            "capacity": 100,
            "raw_data": {
                "zones": [
                    {"code": "Z1", "name": "อาคารเรียน 1"},
                    {"code": "Z2", "name": "หอประชุมใหญ่"},
                ]
            },
            "updated_at": now,
        },
    )
    await _insert_person(
        db_client,
        settings,
        {
            "_id": "evacuee:test_zone_addr",
            "shelter_code": "SH002",
            "first_name": "วันดี",
            "last_name_masked": mask_last_name("มีทรัพย์"),
            "phone_hash": phone_hash(phone),
            "gender": "female",
            "checked_in_at": datetime(2026, 6, 1, 10, 0, tzinfo=UTC),
            "care_zone": "Z1",
            "search_excluded": False,
            "status": "active",
            "updated_at": now,
        },
    )

    response = await client.post(
        "/public/v1/occupants",
        json={"q": phone},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    result = body["results"][0]
    assert result["shelter_name"] == "ศูนย์โรงเรียนอนุบาลแม่สาย"
    assert result["shelter_address"] == "123 หมู่ 4 ต.แม่สาย อ.แม่สาย จ.เชียงราย"
    assert "care_zone" not in result
    assert "zone_name" not in result


async def test_evacuee_search_returns_physical_address_from_location(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    phone = "0877777777"
    now = datetime.now(UTC)
    await _insert_shelter(
        db_client,
        settings,
        {
            "_id": "SH003_TEST",
            "shelter_code": "SH003_TEST",
            "name": "ศูนย์อพยพ ม.อ.",
            "province": "สงขลา",
            "district": "หาดใหญ่",
            "subdistrict": "คอหงส์",
            "status": "open",
            "capacity": 100,
            "raw_data": {
                "location": {
                    "address": "15 ถ.กาญจนวนิช ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา 90110",
                }
            },
            "updated_at": now,
        },
    )
    await _insert_person(
        db_client,
        settings,
        {
            "_id": "evacuee:test_phys_addr",
            "shelter_code": "SH003_TEST",
            "first_name": "สมศรี",
            "last_name_masked": mask_last_name("รักดี"),
            "phone_hash": phone_hash(phone),
            "gender": "female",
            "checked_in_at": datetime(2026, 6, 1, 10, 0, tzinfo=UTC),
            "search_excluded": False,
            "status": "active",
            "updated_at": now,
        },
    )

    response = await client.post(
        "/public/v1/occupants",
        json={"q": phone},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    result = body["results"][0]
    assert result["shelter_address"] == "15 ถ.กาญจนวนิช ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา 90110"


async def _search_names(client: AsyncClient, auth_headers: dict[str, str], query: str) -> list[str]:
    response = await client.post(
        "/public/v1/occupants",
        json={"q": query},
        headers=auth_headers,
    )
    assert response.status_code == 200, query
    return [result["name"] for result in response.json()["results"]]


async def test_evacuee_name_search_needs_first_name_and_full_surname(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """CR-166 / #533 — "สมหมาย มีบุญ" must not return "สมหมาย มี****"."""
    now = datetime.now(UTC)
    people = [
        ("evacuee:1", "สมหมาย", "มีโชค", False),
        ("evacuee:2", "สมหมาย", "ใจดี", False),
        ("evacuee:3", "สมชาย", "มีโชค", False),
        ("evacuee:4", "สมหมายนิด", "มีโชค", True),  # opted out — never returned
    ]
    for person_id, first_name, last_name, excluded in people:
        await _insert_person(
            db_client,
            settings,
            {
                "_id": person_id,
                "shelter_code": "SH001",
                "first_name": first_name,
                "last_name_masked": mask_last_name(last_name),
                "search_excluded": excluded,
                "status": "active",
                "updated_at": now,
            },
            last_name=last_name,
        )
    masked_mi_chok = mask_last_name("มีโชค")

    # Full name: only the person whose first name AND whole surname match.
    assert await _search_names(client, auth_headers, "สมหมาย มีโชค") == [f"สมหมาย {masked_mi_chok}"]
    # The false positives from the issue: right first name, wrong / partial surname.
    assert await _search_names(client, auth_headers, "สมหมาย มีบุญ") == []
    assert await _search_names(client, auth_headers, "สมหมาย บุญ") == []
    # "มี" is one grapheme (consonant + vowel mark), so a bare "มี" word is rejected.
    response = await client.post(
        "/public/v1/occupants", json={"q": "สมหมาย มี"}, headers=auth_headers
    )
    assert response.status_code == 422
    # A first-name prefix plus the whole surname works.
    assert await _search_names(client, auth_headers, "สมห มีโชค") == [f"สมหมาย {masked_mi_chok}"]
    # Surname alone — compared as a hash, so the full surname is needed.
    assert len(await _search_names(client, auth_headers, "มีโชค")) == 2
    assert await _search_names(client, auth_headers, "มีโช") == []
    # First name alone, and a two-character prefix (CR-166 lowers the floor to 2).
    assert len(await _search_names(client, auth_headers, "สมหมาย")) == 2
    assert len(await _search_names(client, auth_headers, "สม")) == 3


async def test_evacuee_name_search_normalizes_case_and_spaces(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """Multi-word first names and surnames match however the relative types the spaces."""
    now = datetime.now(UTC)
    for person_id, first_name, last_name in (
        ("evacuee:a", "John Paul", "van der Berg"),
        ("evacuee:b", "Somchai", "Smith"),
    ):
        await _insert_person(
            db_client,
            settings,
            {
                "_id": person_id,
                "shelter_code": "SH001",
                "first_name": first_name,
                "last_name_masked": mask_last_name(last_name),
                "search_excluded": False,
                "status": "active",
                "updated_at": now,
            },
            last_name=last_name,
        )

    assert len(await _search_names(client, auth_headers, "john paul vander berg")) == 1
    assert len(await _search_names(client, auth_headers, "JOHN  PAUL vanderberg")) == 1
    assert len(await _search_names(client, auth_headers, "john paulvan der berg")) == 0
    assert len(await _search_names(client, auth_headers, "SOMCHAI smith")) == 1
    assert len(await _search_names(client, auth_headers, "somchai smyth")) == 0


async def test_evacuee_name_search_returns_a_stable_order_when_capped(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """More than 10 matches: the 10 returned are always the first ten by first name."""
    now = datetime.now(UTC)
    for index in range(12, 0, -1):  # inserted out of order on purpose
        await _insert_person(
            db_client,
            settings,
            {
                "_id": f"evacuee:{index:02d}",
                "shelter_code": "SH001",
                "first_name": f"ทดสอบ{index:02d}",
                "last_name_masked": mask_last_name("ใจดี"),
                "search_excluded": False,
                "status": "active",
                "updated_at": now,
            },
            last_name="ใจดี",
        )

    masked = mask_last_name("ใจดี")
    expected = [f"ทดสอบ{index:02d} {masked}" for index in range(1, 11)]
    assert await _search_names(client, auth_headers, "ทดสอบ") == expected


async def test_evacuee_name_search_breaks_first_name_ties_by_id(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """Same first name for everyone: `_id` decides which 10 of 12 survive the cap."""
    now = datetime.now(UTC)
    for index in range(12, 0, -1):  # inserted out of order on purpose
        await _insert_person(
            db_client,
            settings,
            {
                "_id": f"evacuee:{index:02d}",
                "shelter_code": "SH001",
                "first_name": "สมศรี",
                # Distinct display surname per row so the response order is observable.
                "last_name_masked": f"ใจ{index:02d}",
                "search_excluded": False,
                "status": "active",
                "updated_at": now,
            },
            last_name="ใจดี",
        )

    expected = [f"สมศรี ใจ{index:02d}" for index in range(1, 11)]
    assert await _search_names(client, auth_headers, "สมศรี") == expected
    assert await _search_names(client, auth_headers, "สมศรี ใจดี") == expected


# ─── ID search is sorted too (#736 decision 5, CR-166 "sort every case") ───────────────────
#
# National-ID / passport / phone searches used to return Mongo's natural order, so which 10 of
# 12 matches survived the cap depended on insertion order. The shared use case now sorts every
# branch by (`first_name_key`, `_id`): affects /public/v1/occupants and /external/v1/occupants.

_ID_QUERIES = {
    "national_id": ("3900100244192", "national_id_hash", national_id_hash),
    "passport": ("AA1234567", "passport_hash", passport_hash),
    "phone": ("0812345678", "phone_hash", phone_hash),
}
_EXTERNAL_API_KEY = "tsk_evacuee_sort_test_key_1234567890"


@pytest.fixture(params=["/public/v1/occupants", "/external/v1/occupants"])
async def search_endpoint(
    request: pytest.FixtureRequest, auth_headers: dict[str, str]
) -> tuple[str, dict[str, str]]:
    """Every endpoint that runs `EvacueeUseCase.search`: public BFF and legacy keyed plane."""
    if request.param.startswith("/public/"):
        return request.param, auth_headers
    await ApiKey(
        id=new_ulid(),
        name="Sort test consumer",
        owner="test",
        key_prefix=_EXTERNAL_API_KEY[:8],
        key_hash=sha256_hex(_EXTERNAL_API_KEY),
        expires_at=datetime.now(UTC) + timedelta(days=30),
        created_by="admin",
        created_at=datetime.now(UTC),
    ).insert()
    return request.param, {"X-API-Key": _EXTERNAL_API_KEY}


async def _insert_twelve_matches(
    db_client: AsyncMongoClient,
    settings: Settings,
    kind: str,
    *,
    same_first_name: bool,
) -> None:
    """12 people sharing one ID hash, inserted in REVERSE order (natural order = 12 … 1)."""
    _, field, hasher = _ID_QUERIES[kind]
    query = _ID_QUERIES[kind][0]
    now = datetime.now(UTC)
    for index in range(12, 0, -1):
        await _insert_person(
            db_client,
            settings,
            {
                "_id": f"evacuee:{index:02d}",
                "shelter_code": "SH001",
                "first_name": "สมศรี" if same_first_name else f"ทดสอบ{index:02d}",
                # Distinct display surname per row so the response order is observable.
                "last_name_masked": f"ใจ{index:02d}",
                field: hasher(query),
                "search_excluded": False,
                "status": "active",
                "updated_at": now,
            },
        )


async def _names(
    client: AsyncClient, endpoint: tuple[str, dict[str, str]], query: str
) -> list[str]:
    url, headers = endpoint
    response = await client.post(url, json={"q": query}, headers=headers)
    assert response.status_code == 200, (url, response.text)
    return [result["name"] for result in response.json()["results"]]


@pytest.mark.parametrize("kind", list(_ID_QUERIES))
async def test_id_search_returns_the_first_ten_by_first_name_key(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    search_endpoint: tuple[str, dict[str, str]],
    kind: str,
):
    """12 matches: the 10 returned are the first ten by first name, whatever the insert order."""
    await _insert_twelve_matches(db_client, settings, kind, same_first_name=False)

    expected = [f"ทดสอบ{index:02d} ใจ{index:02d}" for index in range(1, 11)]
    assert await _names(client, search_endpoint, _ID_QUERIES[kind][0]) == expected


@pytest.mark.parametrize("kind", list(_ID_QUERIES))
async def test_id_search_breaks_first_name_ties_by_id(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    search_endpoint: tuple[str, dict[str, str]],
    kind: str,
):
    """Same first name for everyone: `_id` decides which 10 of 12 survive the cap."""
    await _insert_twelve_matches(db_client, settings, kind, same_first_name=True)

    expected = [f"สมศรี ใจ{index:02d}" for index in range(1, 11)]
    assert await _names(client, search_endpoint, _ID_QUERIES[kind][0]) == expected


async def test_public_search_still_returns_cancelled_people_and_family_members(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    search_endpoint: tuple[str, dict[str, str]],
):
    """Regression (#736 decision 3/4): EXT-012 drops `cancelled` + family at ITS layer only.

    The shared use case behind /public/v1/occupants and /external/v1/occupants keeps reporting
    a cancelled stay as `cancelled` (CR-099) and keeps the household members (CR-080).
    """
    phone = "0833333333"
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
    for doc_id, first_name, stay_status in [
        ("evacuee:cancelled-parent", "พ่อ", "cancelled"),
        ("evacuee:cancelled-child", "ลูก", "cancelled"),
    ]:
        await _insert_person(
            db_client,
            settings,
            {
                "_id": doc_id,
                "shelter_code": "SH001",
                "first_name": first_name,
                "last_name_masked": mask_last_name("ใจดี"),
                "phone_hash": phone_hash(phone) if first_name == "พ่อ" else None,
                "household_id": "household:cancelled",
                "search_excluded": False,
                "status": stay_status,
                "updated_at": now,
            },
        )

    path, headers = search_endpoint
    response = await client.post(path, json={"q": phone}, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["status"] == "cancelled"
    members = body["results"][0]["family_members"]
    assert [m["name"] for m in members] == [f"ลูก {mask_last_name('ใจดี')}"]
    assert members[0]["status"] == "cancelled"


async def test_basic_consent_person_leaves_occupant_search(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """PDPA FR-40 — the worker deletes a basic-mode person's projection (worker
    `test_project_evacuee_basic_consent_deletes_projection`); search then skips them."""
    phone = "0877777777"
    now = datetime.now(UTC)
    for suffix, first_name in (("visible", "เห็น"), ("basic", "พื้นฐาน")):
        await _insert_person(
            db_client,
            settings,
            {
                "_id": f"evacuee:{suffix}",
                "shelter_code": "SH001",
                "first_name": first_name,
                "last_name_masked": mask_last_name("ใจดี"),
                "phone_hash": phone_hash(phone),
                "search_excluded": False,
                "status": "active",
                "updated_at": now,
            },
        )
    before = await client.post("/public/v1/occupants", json={"q": phone}, headers=auth_headers)
    assert before.json()["count"] == 2

    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_persons"].delete_one({"_id": "evacuee:basic"})

    after = await client.post("/public/v1/occupants", json={"q": phone}, headers=auth_headers)
    assert after.status_code == 200
    assert after.json()["count"] == 1
    assert [r["name"].split()[0] for r in after.json()["results"]] == ["เห็น"]


# ─── CR-183: shelter_status on results and family members, zone keys removed ───────────────


async def _seed_household(
    db_client: AsyncMongoClient,
    settings: Settings,
    *,
    shelter: dict | None,
    phone: str,
) -> None:
    now = datetime.now(UTC)
    if shelter is not None:
        await _insert_shelter(
            db_client,
            settings,
            {
                "_id": "SH009",
                "shelter_code": "SH009",
                "name": "ศูนย์ทดสอบ",
                "capacity": 10,
                "updated_at": now,
                **shelter,
            },
        )
    for doc_id, first_name in [("evacuee:p", "พ่อ"), ("evacuee:c", "ลูก")]:
        await _insert_person(
            db_client,
            settings,
            {
                "_id": doc_id,
                "shelter_code": "SH009",
                "first_name": first_name,
                "last_name_masked": mask_last_name("ใจดี"),
                "phone_hash": phone_hash(phone) if doc_id == "evacuee:p" else None,
                "household_id": "household:09",
                "care_zone": "Z1",
                "search_excluded": False,
                "status": "active",
                "updated_at": now,
            },
        )


@pytest.mark.parametrize("shelter_status", ["open", "closed", "full", "standby"])
async def test_search_reports_shelter_status_on_hit_and_family_member(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    search_endpoint: tuple[str, dict[str, str]],
    shelter_status: str,
):
    phone = "0811111119"
    await _seed_household(db_client, settings, shelter={"status": shelter_status}, phone=phone)

    url, headers = search_endpoint
    response = await client.post(url, json={"q": phone}, headers=headers)

    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["shelter_status"] == shelter_status
    assert [m["shelter_status"] for m in result["family_members"]] == [shelter_status]


async def test_search_shelter_status_is_null_without_shelter_row(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    search_endpoint: tuple[str, dict[str, str]],
):
    phone = "0811111118"
    await _seed_household(db_client, settings, shelter=None, phone=phone)

    url, headers = search_endpoint
    response = await client.post(url, json={"q": phone}, headers=headers)

    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["shelter_status"] is None
    assert result["shelter_name"] == "SH009"
    assert [m["shelter_status"] for m in result["family_members"]] == [None]


async def test_search_response_has_no_zone_keys_for_open_or_closed_shelters(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    search_endpoint: tuple[str, dict[str, str]],
):
    phone = "0811111117"
    await _seed_household(
        db_client,
        settings,
        shelter={"status": "closed", "raw_data": {"zones": [{"code": "Z1", "name": "อาคาร 1"}]}},
        phone=phone,
    )

    url, headers = search_endpoint
    response = await client.post(url, json={"q": phone}, headers=headers)

    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert "care_zone" not in result
    assert "zone_name" not in result
