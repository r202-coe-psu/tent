"""EXT-002/003 — partner Location Master read endpoint tests (partner ODT)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from shelter_factory import flag_raw, insert_shelter
from tent_model.public_shelter import GeoPoint, PublicShelter

from apiapp.modules.thirdparty_auth.scopes import mint_access_token
from apiapp.modules.thirdparty_locations.dopa_codes import DopaCodes, lookup_dopa_codes


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
            # #751: staff switched pre-registration on, so partners may book this shelter.
            "feature_flags": {"accepts_pre_registration": True},
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
    response = await client.get("/external/locations")
    assert response.status_code == 401
    body = response.json()
    assert body["status"] == 401
    assert body["code"] == "invalid_token"


async def test_list_locations_rejects_insufficient_scope(client: AsyncClient) -> None:
    headers = _bearer(["occupancy-read"])
    response = await client.get("/external/locations", headers=headers)
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
    response = await client.get("/external/locations", headers=location_read_headers)
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
        "/external/locations",
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
        "/external/locations",
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
        "/external/locations",
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
    response = await client.get("/external/locations/SH001", headers=location_read_headers)
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
    assert result["subdistrict_code"] == "901104"
    assert result["district_code"] == "9011"
    assert result["province_code"] == "90"
    assert result["contact_name"] == "หัวหน้าศูนย์พักพิง"
    assert result["contact_phone"] == "074-000000"
    assert result["accepts_delivery"] is True
    assert result["accepts_booking"] is True
    assert result["is_active"] is True
    assert result["occupancy_total"] == 0
    assert "ห้องน้ำ 12 ห้อง" in result["facilities"]
    assert "ครัวกลาง" in result["facilities"]
    assert "ไฟฟ้าสำรอง (เครื่องปั่นไฟ)" in result["facilities"]


async def test_get_location_returns_null_dopa_codes_when_unmapped(
    client: AsyncClient, location_read_headers: dict[str, str], closed_shelter: PublicShelter
) -> None:
    response = await client.get("/external/locations/SH002", headers=location_read_headers)
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["province_code"] is None
    assert result["district_code"] is None
    assert result["subdistrict_code"] is None
    assert result["facilities"] == []


async def test_get_location_unknown_code_returns_location_not_found(
    client: AsyncClient, location_read_headers: dict[str, str]
) -> None:
    response = await client.get("/external/locations/NOPE", headers=location_read_headers)
    assert response.status_code == 404
    body = response.json()
    assert body["status"] == 404
    assert body["code"] == "location_not_found"
    assert body["result"] == []


def test_dopa_lookup_choporo_ranong() -> None:
    """Tambon จ.ป.ร. in Kraburi, Ranong (850406)."""
    res = lookup_dopa_codes("ระนอง", "กระบุรี", "จ.ป.ร.")
    assert res == DopaCodes(
        province_code="85",
        district_code="8504",
        subdistrict_code="850406",
    )


def test_dopa_lookup_whitespace_and_prefixes_stripping() -> None:
    # Full prefixes + whitespace
    res1 = lookup_dopa_codes("  จังหวัดสงขลา  ", "  อำเภอหาดใหญ่  ", "  ตำบลคอหงส์  ")
    assert res1 == DopaCodes(
        province_code="90",
        district_code="9011",
        subdistrict_code="901104",
    )

    # Abbreviated prefixes
    res2 = lookup_dopa_codes("จ.ระนอง", "อ.กระบุรี", "ต.จ.ป.ร.")
    assert res2 == DopaCodes(
        province_code="85",
        district_code="8504",
        subdistrict_code="850406",
    )


def test_dopa_lookup_bangkok_with_and_without_khet() -> None:
    # Without เขต and without แขวง (standard format from frontend JSON)
    res1 = lookup_dopa_codes("กรุงเทพมหานคร", "พระนคร", "พระบรมมหาราชวัง")
    assert res1 == DopaCodes(
        province_code="10",
        district_code="1001",
        subdistrict_code="100101",
    )

    # With เขต and with แขวง
    res2 = lookup_dopa_codes("กรุงเทพมหานคร", "เขตพระนคร", "แขวงพระบรมมหาราชวัง")
    assert res2 == DopaCodes(
        province_code="10",
        district_code="1001",
        subdistrict_code="100101",
    )

    # Bangkok province aliases
    for prov in ("กรุงเทพฯ", "กรุงเทพ", "กทม", "กทม."):
        res = lookup_dopa_codes(prov, "บางรัก", "สีลม")
        assert res == DopaCodes(
            province_code="10",
            district_code="1004",
            subdistrict_code="100402",
        )


def test_dopa_lookup_spelling_aliases() -> None:
    # Su-ngai Kolok without hyphen
    res = lookup_dopa_codes("นราธิวาส", "สุไหงโกลก", "สุไหงโกลก")
    assert res == DopaCodes(
        province_code="96",
        district_code="9610",
        subdistrict_code="961001",
    )

    # Wat Sai in Nakhon Sawan
    res_watsai = lookup_dopa_codes("นครสวรรค์", "เมืองนครสวรรค์", "วัดไทร")
    assert res_watsai == DopaCodes(
        province_code="60",
        district_code="6001",
        subdistrict_code="600113",
    )

    # Huai Khayung in Warin Chamrap
    res_khayung = lookup_dopa_codes("อุบลราชธานี", "วารินชำราบ", "ห้วยขะยูง")
    assert res_khayung == DopaCodes(
        province_code="34",
        district_code="3415",
        subdistrict_code="341524",
    )

    # Sob Khong in Omkoi, Chiang Mai
    res_sobkhong = lookup_dopa_codes("เชียงใหม่", "อมก๋อย", "สบโขง")
    assert res_sobkhong == DopaCodes(
        province_code="50",
        district_code="5018",
        subdistrict_code="501805",
    )


def test_dopa_lookup_partial_and_edge_cases() -> None:
    assert lookup_dopa_codes(None, None, None) == DopaCodes(None, None, None)
    assert lookup_dopa_codes("สงขลา", None, None) == DopaCodes("90", None, None)
    assert lookup_dopa_codes("สงขลา", "หาดใหญ่", None) == DopaCodes("90", "9011", None)
    assert lookup_dopa_codes("", "   ", "\t\n") == DopaCodes(None, None, None)
    assert lookup_dopa_codes("ไม่มีจริง", "ไม่มีจริง", "ไม่มีจริง") == DopaCodes(None, None, None)


async def test_list_locations_pagination(
    client: AsyncClient,
    location_read_headers: dict[str, str],
    open_hatyai_shelter: PublicShelter,
    closed_shelter: PublicShelter,
) -> None:
    # Default page 1, limit 50
    resp = await client.get("/external/locations", headers=location_read_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "pagination" in body
    assert body["pagination"]["page"] == 1
    assert body["pagination"]["limit"] == 50
    assert body["pagination"]["total"] >= 2
    assert len(body["result"]) >= 2

    # Limit 1, page 1
    p1_resp = await client.get("/external/locations?page=1&limit=1", headers=location_read_headers)
    assert p1_resp.status_code == 200
    p1 = p1_resp.json()
    assert len(p1["result"]) == 1
    assert p1["pagination"]["page"] == 1
    assert p1["pagination"]["limit"] == 1
    assert p1["pagination"]["total_pages"] >= 2

    # Limit 1, page 2
    p2_resp = await client.get("/external/locations?page=2&limit=1", headers=location_read_headers)
    assert p2_resp.status_code == 200
    p2 = p2_resp.json()
    assert len(p2["result"]) == 1
    assert p2["pagination"]["page"] == 2
    assert p2["result"][0]["location_code"] != p1["result"][0]["location_code"]


# --- #751 accepts_booking ------------------------------------------------------------
# accepts_booking = location_status != "closed" AND raw_data.feature_flags.accepts_pre_registration
# is True (a missing flag is NOT bookable). Same value for every partner, whatever its scopes.

ACCEPTS_BOOKING_CASES = [
    ("open", True, True),
    ("full", True, True),
    ("standby", True, True),
    ("open", None, False),
    ("full", None, False),
    ("standby", None, False),
    ("open", False, False),
    ("full", False, False),
    ("standby", False, False),
    ("closed", True, False),
    ("closed", None, False),
    ("closed", False, False),
]


@pytest.mark.parametrize(("status", "flag", "expected"), ACCEPTS_BOOKING_CASES)
async def test_accepts_booking_truth_table_on_detail_and_list(
    client: AsyncClient,
    location_read_headers: dict[str, str],
    status: str,
    flag: bool | None,
    expected: bool,
) -> None:
    await insert_shelter("SH900", status=status, raw_data=flag_raw(flag))

    detail = await client.get("/external/locations/SH900", headers=location_read_headers)
    assert detail.status_code == 200
    assert detail.json()["result"]["accepts_booking"] is expected

    listing = await client.get("/external/locations", headers=location_read_headers)
    assert listing.status_code == 200
    (item,) = [i for i in listing.json()["result"] if i["location_code"] == "SH900"]
    assert item["accepts_booking"] is expected


async def test_accepts_booking_does_not_depend_on_the_token(client: AsyncClient) -> None:
    await insert_shelter("SH900", raw_data=flag_raw(True))
    for scopes in (["location-read"], ["location-read", "booking-write", "booking-bypass"]):
        detail = await client.get("/external/locations/SH900", headers=_bearer(scopes))
        assert detail.status_code == 200
        assert detail.json()["result"]["accepts_booking"] is True


@pytest.fixture
async def mixed_shelters() -> None:
    """Three bookable (SH101-103, one full), three not (flag missing / False / closed)."""
    await insert_shelter("SH101", raw_data=flag_raw(True))
    await insert_shelter("SH102", status="full", raw_data=flag_raw(True))
    await insert_shelter("SH103", status="standby", raw_data=flag_raw(True))
    await insert_shelter("SH201", raw_data=flag_raw(None))
    await insert_shelter("SH202", raw_data=flag_raw(False))
    await insert_shelter("SH203", status="closed", raw_data=flag_raw(True))


async def _codes(client: AsyncClient, headers: dict[str, str], **params: object) -> set[str]:
    response = await client.get("/external/locations", headers=headers, params=params)
    assert response.status_code == 200
    return {item["location_code"] for item in response.json()["result"]}


async def test_list_locations_filters_accepts_booking_true(
    client: AsyncClient, location_read_headers: dict[str, str], mixed_shelters: None
) -> None:
    codes = await _codes(client, location_read_headers, accepts_booking="true")
    assert codes == {"SH101", "SH102", "SH103"}


async def test_list_locations_filters_accepts_booking_false(
    client: AsyncClient, location_read_headers: dict[str, str], mixed_shelters: None
) -> None:
    codes = await _codes(client, location_read_headers, accepts_booking="false")
    assert codes == {"SH201", "SH202", "SH203"}


async def test_list_locations_without_the_filter_returns_both(
    client: AsyncClient, location_read_headers: dict[str, str], mixed_shelters: None
) -> None:
    codes = await _codes(client, location_read_headers)
    assert codes == {"SH101", "SH102", "SH103", "SH201", "SH202", "SH203"}


async def test_list_locations_accepts_booking_combines_with_status(
    client: AsyncClient, location_read_headers: dict[str, str], mixed_shelters: None
) -> None:
    assert await _codes(client, location_read_headers, accepts_booking="true", status="full") == {
        "SH102"
    }
    assert await _codes(client, location_read_headers, accepts_booking="false", status="open") == {
        "SH201",
        "SH202",
    }
    # closed never accepts bookings, whatever its flag says
    assert await _codes(client, location_read_headers, accepts_booking="true", status="closed") == (
        set()
    )
    assert await _codes(
        client, location_read_headers, accepts_booking="false", status="closed"
    ) == {"SH203"}


async def test_list_locations_accepts_booking_pagination_total(
    client: AsyncClient, location_read_headers: dict[str, str], mixed_shelters: None
) -> None:
    yes = await client.get(
        "/external/locations",
        headers=location_read_headers,
        params={"accepts_booking": "true", "limit": 2, "page": 1},
    )
    assert yes.status_code == 200
    body = yes.json()
    assert len(body["result"]) == 2
    assert body["pagination"]["total"] == 3
    assert body["pagination"]["total_pages"] == 2
    assert all(item["accepts_booking"] is True for item in body["result"])

    page2 = await client.get(
        "/external/locations",
        headers=location_read_headers,
        params={"accepts_booking": "true", "limit": 2, "page": 2},
    )
    assert len(page2.json()["result"]) == 1
    assert page2.json()["pagination"]["total"] == 3

    no = await client.get(
        "/external/locations",
        headers=location_read_headers,
        params={"accepts_booking": "false", "limit": 2},
    )
    assert no.json()["pagination"]["total"] == 3
    assert no.json()["pagination"]["total_pages"] == 2
    assert all(item["accepts_booking"] is False for item in no.json()["result"])


@pytest.mark.parametrize("value", ["abc", "maybe", "2"])
async def test_list_locations_rejects_a_non_boolean_accepts_booking(
    client: AsyncClient, location_read_headers: dict[str, str], value: str
) -> None:
    response = await client.get(
        "/external/locations",
        headers=location_read_headers,
        params={"accepts_booking": value},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


@pytest.mark.parametrize(
    "value",
    ["yes", "no", "on", "off", "1", "0", "t", "f", "y", "n", "abc", "", " ", "True", "FALSE"],
)
async def test_list_locations_accepts_booking_takes_only_lowercase_true_or_false(
    client: AsyncClient, location_read_headers: dict[str, str], value: str
) -> None:
    """Only lowercase `true` / `false` are valid (no bool coercion, no case folding)."""
    response = await client.get(
        "/external/locations",
        headers=location_read_headers,
        params={"accepts_booking": value},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


MALFORMED_FLAG_RAW = [
    {"feature_flags": "yes"},
    {"feature_flags": None},
    {"feature_flags": ["accepts_pre_registration"]},
    {"feature_flags": [{"accepts_pre_registration": True}]},
    {"feature_flags": {"accepts_pre_registration": "true"}},
    {"feature_flags": {"accepts_pre_registration": 1}},
    {"feature_flags": {"accepts_pre_registration": [True]}},
]


@pytest.mark.parametrize("raw", MALFORMED_FLAG_RAW)
async def test_malformed_feature_flags_are_not_bookable_and_never_500(
    client: AsyncClient, location_read_headers: dict[str, str], raw: dict[str, object]
) -> None:
    """EXT-003 / EXT-002 answer 200 with `accepts_booking: false`; the filter agrees (#751 F1)."""
    await insert_shelter("SH900", raw_data=raw)
    await insert_shelter("SH901", raw_data=flag_raw(True))

    detail = await client.get("/external/locations/SH900", headers=location_read_headers)
    assert detail.status_code == 200
    assert detail.json()["result"]["accepts_booking"] is False

    listing = await client.get("/external/locations", headers=location_read_headers)
    assert listing.status_code == 200
    by_code = {i["location_code"]: i["accepts_booking"] for i in listing.json()["result"]}
    assert by_code == {"SH900": False, "SH901": True}

    assert await _codes(client, location_read_headers, accepts_booking="true") == {"SH901"}
    assert await _codes(client, location_read_headers, accepts_booking="false") == {"SH900"}
