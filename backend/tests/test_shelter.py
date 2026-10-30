"""Tests for shelter public list endpoint."""

from datetime import UTC, datetime

from httpx import AsyncClient
from pymongo import AsyncMongoClient

from apiapp.core.config import Settings


async def _insert_shelter_doc(
    db_client: AsyncMongoClient,
    settings: Settings,
    doc: dict,
) -> None:
    db_name = settings.DATABASE_URI.rsplit("/", 1)[-1]
    await db_client[db_name]["public_shelters"].insert_one(doc)


def _shelter_doc(code: str, status: str = "open", feature_flags: dict | None = None) -> dict:
    """public_shelters document; `feature_flags=None` leaves `feature_flags` out of raw_data."""
    raw: dict = {"operation_status": "active", "capacity": 100}
    if feature_flags is not None:
        raw["feature_flags"] = feature_flags
    return {
        "_id": code,
        "shelter_code": code,
        "name": f"ศูนย์ {code}",
        "status": status,
        "capacity": 100,
        "province": "สงขลา",
        "updated_at": datetime.now(UTC),
        "raw_data": raw,
    }


async def test_list_shelters_requires_bearer(client: AsyncClient):
    response = await client.get("/public/v1/shelters")
    assert response.status_code == 401


async def test_list_shelters_returns_open_shelters(
    client: AsyncClient,
    db_client: AsyncMongoClient,
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
    db_client: AsyncMongoClient,
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
    db_client: AsyncMongoClient,
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


async def test_list_shelters_filters_by_master_site_kind_code(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    now = datetime.now(UTC)
    for code, name, kind in (
        ("SH001", "ศูนย์ทดสอบ", "evacuation_center"),
        ("SH002", "โรงพยาบาลสนาม", "field_hospital"),
    ):
        await _insert_shelter_doc(
            db_client,
            settings,
            {
                "_id": code,
                "shelter_code": code,
                "name": name,
                "site_kind": kind,
                "status": "open",
                "capacity": 50,
                "updated_at": now,
            },
        )

    response = await client.get(
        "/public/v1/shelters",
        params={"site_kind": "field_hospital"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["shelters"][0]["code"] == "SH002"
    assert body["shelters"][0]["site_kind"] == "field_hospital"

    unused = await client.get(
        "/public/v1/shelters",
        params={"site_kind": "no_such_kind"},
        headers=auth_headers,
    )
    assert unused.status_code == 200
    assert unused.json()["count"] == 0
    assert unused.json()["shelters"] == []


async def test_list_shelters_filters_by_radius(
    client: AsyncClient,
    db_client: AsyncMongoClient,
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
    db_client: AsyncMongoClient,
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
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """CR-112 — public `occupancy` is Forecast; `present` / `in_zone` are additive."""
    # The worker counts every evacuee's stay status from CouchDB (PDPA D8 — this includes
    # search-excluded people, who have no `public_persons` row).
    doc = _shelter_doc("SH001", "open")
    doc["occupancy_by_status"] = {
        "active": 3,
        "pre_registered": 2,
        "kiosk_registered": 1,
        "arriving": 1,
        "room_confirmed": 1,
        "temporary_leave": 1,
        # Terminal statuses do not hold a Forecast seat.
        "cancelled": 1,
        "checked_out": 1,
    }
    await _insert_shelter_doc(db_client, settings, doc)
    # A searchable person row is not the source of the count.
    await _insert_person_doc(db_client, settings, "evacuee:a0", "SH001", "active")

    response = await client.get("/public/v1/shelters/SH001", headers=auth_headers)
    assert response.status_code == 200

    shelter = response.json()["shelter"]
    # Forecast: 3 active + 2 pre_registered + 1 kiosk_registered + 1 arriving
    # + 1 room_confirmed + 1 temporary_leave = 9
    assert shelter["occupancy"] == 9
    # Present: 3 active + 1 room_confirmed + 1 temporary_leave = 5
    assert shelter["present"] == 5
    # In-zone: room_confirmed only
    assert shelter["in_zone"] == 1
    assert shelter["capacity"]["total"] == 100
    assert shelter["capacity"]["available"] == 91
    assert shelter["occupancy_rate"] == 9


async def test_shelter_detail_occupancy_is_zero_when_deactivated(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """A deactivated shelter keeps its last `occupancy_by_status`; it must not be shown."""
    doc = _shelter_doc("SH001", "closed")
    doc["is_active"] = False
    doc["occupancy_by_status"] = {"active": 4}
    await _insert_shelter_doc(db_client, settings, doc)

    response = await client.get("/public/v1/shelters/SH001", headers=auth_headers)
    assert response.status_code == 200
    shelter = response.json()["shelter"]
    assert (shelter["occupancy"], shelter["present"], shelter["in_zone"]) == (0, 0, 0)


async def test_shelter_detail_occupancy_falls_back_to_persons_before_reprojection(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """A row without the `occupancy_by_status` key (written before PDPA D8) counts
    `public_persons` as before, until the worker bootstrap re-projects it."""
    await _insert_shelter_doc(db_client, settings, _shelter_doc("SH001", "open"))
    await _insert_person_doc(db_client, settings, "evacuee:a0", "SH001", "active")
    await _insert_person_doc(db_client, settings, "evacuee:p0", "SH001", "pre_registered")
    await _insert_person_doc(db_client, settings, "evacuee:r0", "SH001", "room_confirmed")
    await _insert_person_doc(db_client, settings, "evacuee:x0", "SH002", "active")

    response = await client.get("/public/v1/shelters/SH001", headers=auth_headers)
    assert response.status_code == 200
    shelter = response.json()["shelter"]
    assert (shelter["occupancy"], shelter["present"], shelter["in_zone"]) == (3, 2, 1)


# --- #751 regression: public `accepts_pre_registration` is unchanged -----------------------
# The flag logic moves into a helper shared with the partner plane (EXT-002/003/008). The public
# field stays "the staff switch is exactly True" — a missing flag is False, and the shelter's
# status is NOT folded in (the SPA's `isShelterBookable` combines the two itself).


async def test_public_accepts_pre_registration_on_list_and_detail(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    cases = {
        "SH101": ("open", {"accepts_pre_registration": True}, True),
        "SH102": ("open", {"accepts_pre_registration": False}, False),
        "SH103": ("open", {}, False),
        "SH104": ("open", None, False),
        "SH105": ("full", {"accepts_pre_registration": True}, True),
    }
    for code, (status, flags, _) in cases.items():
        await _insert_shelter_doc(db_client, settings, _shelter_doc(code, status, flags))

    listing = await client.get("/public/v1/shelters", headers=auth_headers)
    assert listing.status_code == 200
    by_code = {s["code"]: s for s in listing.json()["shelters"]}
    for code, (_, _, expected) in cases.items():
        assert by_code[code]["accepts_pre_registration"] is expected, code

    for code, (_, _, expected) in cases.items():
        detail = await client.get(f"/public/v1/shelters/{code}", headers=auth_headers)
        assert detail.status_code == 200
        assert detail.json()["shelter"]["accepts_pre_registration"] is expected, code


async def test_public_accepts_pre_registration_ignores_shelter_status(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """Unlike the partner `accepts_booking`, the public field is the flag alone."""
    await _insert_shelter_doc(
        db_client, settings, _shelter_doc("SH106", "closed", {"accepts_pre_registration": True})
    )
    detail = await client.get("/public/v1/shelters/SH106", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["shelter"]["accepts_pre_registration"] is True


# --- CR-205: donation_points (detail only, projected field only) ---


_TICKED = {"accepts_donations": True}


def _point(point_id: str, name: str, **over) -> dict:
    return {
        "id": point_id,
        "name": name,
        "types": ["food_dry"],
        "geo": {"lat": 7.0086, "lng": 100.4747},
        "location_note": "ประตู 2",
        **over,
    }


async def test_shelter_detail_returns_projected_donation_points_only(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """AC-5: raw_data holds 3 points; only the projected one is public, and no area_m2."""
    doc = _shelter_doc("SH201")
    doc["raw_data"]["common_areas"] = {
        "sub_storage": [
            {"id": "a", "name": "โรงยิม", "area_m2": 40, **_TICKED, "lat": 7, "lng": 100},
            {"id": "b", "name": "ห้องยา", "area_m2": 9, **_TICKED},
            {"id": "c", "name": "โรงครัว", "area_m2": 12, "accepts_donations": False},
        ]
    }
    doc["donation_points"] = [_point("a", "โรงยิม")]
    await _insert_shelter_doc(db_client, settings, doc)

    response = await client.get("/public/v1/shelters/SH201", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["shelter"]["donation_points"] == [_point("a", "โรงยิม")]
    assert "area_m2" not in response.text.split('"donation_points"')[1].split('"faq"')[0]


async def test_shelter_detail_donation_points_empty_when_not_projected(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """AC-6 / rollout: a row not yet re-projected has no key, and raw_data points do not leak."""
    doc = _shelter_doc("SH202")
    doc["raw_data"]["common_areas"] = {
        "sub_storage": [{"id": "a", "name": "โรงยิม", **_TICKED, "lat": 7, "lng": 100}]
    }
    await _insert_shelter_doc(db_client, settings, doc)

    response = await client.get("/public/v1/shelters/SH202", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["shelter"]["donation_points"] == []


async def test_shelter_list_has_no_donation_points(
    client: AsyncClient,
    db_client: AsyncMongoClient,
    settings: Settings,
    auth_headers: dict[str, str],
):
    """AC-11: only the detail carries donation_points."""
    doc = _shelter_doc("SH203")
    doc["donation_points"] = [_point("a", "โรงยิม")]
    await _insert_shelter_doc(db_client, settings, doc)

    response = await client.get("/public/v1/shelters", headers=auth_headers)
    assert response.status_code == 200
    item = next(s for s in response.json()["shelters"] if s["code"] == "SH203")
    assert "donation_points" not in item
