"""`public_needs` rows are cards (shelter + item + drop-off point) — CR-206 A2."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from bson import Decimal128
from httpx import AsyncClient
from tent_model.api_key import ApiKey
from tent_model.public_need import PublicNeed
from tent_model.public_shelter import DonationPoint, GeoPoint, PublicShelter

from apiapp.utils.masking import sha256_hex
from apiapp.utils.ulid import new_ulid

PLAIN_KEY = "tsk_needs_cards_test_key_1234567890"
GEO = GeoPoint(lat=7.0, lng=100.4)


async def _external_key() -> dict[str, str]:
    await ApiKey(
        id=new_ulid(),
        name="ext",
        owner="ext",
        key_prefix=PLAIN_KEY[:8],
        key_hash=sha256_hex(PLAIN_KEY),
        expires_at=datetime(2999, 1, 1, tzinfo=UTC),
        created_by="admin",
        created_at=datetime.now(UTC),
    ).insert()
    return {"X-API-Key": PLAIN_KEY}


async def _shelter() -> None:
    await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ 1",
        status="open",
        capacity=10,
        geo=GEO,
        updated_at=datetime.now(UTC),
        donation_points=[
            DonationPoint(id="gym", name="โรงยิม", geo=GEO),
            DonationPoint(id="clinic", name="ห้องพยาบาล", geo=GEO),
        ],
    ).insert()


async def _row(doc_id: str, **over) -> None:
    fields = {
        "_id": doc_id,
        "shelter_code": "SH001",
        "item_name": "ข้าว",
        "category": "food",
        "qty_needed": 10.0,
        "qty_target": 10.0,
        "on_hand": 0.0,
        "reserved": 0.0,
        "unit": "kg",
        "updated_at": datetime.now(UTC),
        **over,
    }
    await PublicNeed(**fields).insert()


async def _seed_cards() -> None:
    await _shelter()
    await _row(
        "SH001:item_master:rice@gym",
        item_id="item_master:rice",
        drop_off_point_id="gym",
        qty_needed=20.0,
        qty_target=20.0,
        on_hand=5.0,
        reserved=1.0,
    )
    await _row(
        "SH001:item_master:rice@clinic",
        item_id="item_master:rice",
        drop_off_point_id="clinic",
        qty_needed=50.0,
        qty_target=60.0,
        on_hand=5.0,
        reserved=2.0,
        urgency="critical",
    )
    await _row(
        "SH001:item_master:rice@-",
        item_id="item_master:rice",
        drop_off_point_id=None,
        qty_needed=3.0,
        qty_target=3.0,
        on_hand=5.0,
    )
    await _row(
        "SH001:item_master:rice@gone",
        item_id="item_master:rice",
        drop_off_point_id="gone",
        qty_needed=1.0,
        qty_target=1.0,
        on_hand=5.0,
    )


async def test_public_needs_returns_one_row_per_card_with_point_name(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _seed_cards()

    res = await client.get("/public/v1/needs", headers=auth_headers)

    assert res.status_code == 200
    needs = res.json()["shelters"][0]["needs"]
    assert len(needs) == 4
    by_point = {n["drop_off_point_id"]: n for n in needs}
    assert {n["item_id"] for n in needs} == {"item_master:rice"}
    assert by_point["gym"]["drop_off_point_name"] == "โรงยิม"
    assert by_point["gym"]["qty_needed"] == "20"
    assert by_point["clinic"]["drop_off_point_name"] == "ห้องพยาบาล"
    assert by_point[None]["drop_off_point_name"] is None
    # id no longer among the shelter's points -> name is null, id kept
    assert by_point["gone"]["drop_off_point_name"] is None


async def test_public_needs_reads_rows_projected_before_the_card_split(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _shelter()
    await _row("SH001:item_master:legacy")

    res = await client.get("/public/v1/needs", headers=auth_headers)

    (need,) = res.json()["shelters"][0]["needs"]
    assert need["item_id"] == "item_master:legacy"
    assert need["drop_off_point_id"] is None
    assert need["drop_off_point_name"] is None


async def test_external_needs_sums_cards_back_into_the_old_shape(client: AsyncClient) -> None:
    headers = await _external_key()
    await _seed_cards()

    res = await client.get("/external/v1/needs", headers=headers)

    assert res.status_code == 200
    (shelter,) = res.json()["shelters"]
    (need,) = shelter["needs"]
    assert set(need) == {
        "item_id",
        "name",
        "qty_needed",
        "qty_target",
        "on_hand",
        "reserved",
        "unit",
        "status",
        "urgency",
        "category",
    }
    assert need["item_id"] == "item_master:rice"
    assert float(need["qty_needed"]) == 74.0
    assert float(need["qty_target"]) == 84.0
    assert float(need["reserved"]) == 3.0
    assert float(need["on_hand"]) == 5.0
    assert need["urgency"] == "critical"
    assert need["status"] == "open"


async def test_public_needs_prints_qty_str_not_float_repr(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _shelter()
    await _row(
        "SH001:item_master:rice@-",
        item_id="item_master:rice",
        qty_needed=Decimal("0.3"),
        qty_target=Decimal("1E+2"),
        on_hand=Decimal("0.00001"),
        reserved=Decimal("20.5000"),
    )

    res = await client.get("/public/v1/needs", headers=auth_headers)

    (need,) = res.json()["shelters"][0]["needs"]
    assert need["qty_needed"] == "0.3"
    assert need["qty_target"] == "100"
    assert need["on_hand"] == "0"  # 0.00001 rounds away at four places; no "1E-5"
    assert need["reserved"] == "20.5"
    assert need["status"] == "open"


async def test_public_needs_reads_a_legacy_double_row(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Rows projected before Decimal128 hold a BSON double; they must still load."""
    await _shelter()
    await PublicNeed.get_pymongo_collection().insert_one(
        {
            "_id": "SH001:item_master:rice@-",
            "shelter_code": "SH001",
            "item_id": "item_master:rice",
            "drop_off_point_id": None,
            "item_name": "ข้าว",
            "category": "food",
            "qty_needed": 5.0,
            "qty_target": 7.5,
            "on_hand": 0.1,
            "reserved": 0.2,
            "unit": "kg",
            "urgency": "normal",
            "updated_at": datetime.now(UTC),
        }
    )

    res = await client.get("/public/v1/needs", headers=auth_headers)

    (need,) = res.json()["shelters"][0]["needs"]
    assert need["qty_needed"] == "5"
    assert need["qty_target"] == "7.5"
    assert need["on_hand"] == "0.1"
    assert need["reserved"] == "0.2"


async def test_public_needs_reads_decimal128_stored_values(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _shelter()
    await _row("SH001:item_master:rice@-", item_id="item_master:rice", qty_needed=Decimal("0.3"))
    raw = await PublicNeed.get_pymongo_collection().find_one({"_id": "SH001:item_master:rice@-"})
    assert isinstance(raw["qty_needed"], Decimal128)

    res = await client.get("/public/v1/needs", headers=auth_headers)

    (need,) = res.json()["shelters"][0]["needs"]
    assert need["qty_needed"] == "0.3"


async def test_public_needs_status_follows_the_rounded_qty(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A sub-step remainder prints as "0" and must therefore read closed."""
    await _shelter()
    await _row(
        "SH001:item_master:rice@-", item_id="item_master:rice", qty_needed=Decimal("0.00004")
    )

    res = await client.get("/public/v1/needs", headers=auth_headers)

    (need,) = res.json()["shelters"][0]["needs"]
    assert need["qty_needed"] == "0"
    assert need["status"] == "closed"


async def test_external_needs_sums_decimals_exactly(client: AsyncClient) -> None:
    headers = await _external_key()
    await _shelter()
    for point, needed in (("gym", "0.1"), ("clinic", "0.2")):
        await _row(
            f"SH001:item_master:rice@{point}",
            item_id="item_master:rice",
            drop_off_point_id=point,
            qty_needed=Decimal(needed),
            qty_target=Decimal(needed),
            reserved=Decimal(needed),
        )

    res = await client.get("/external/v1/needs", headers=headers)

    (need,) = res.json()["shelters"][0]["needs"]
    assert need["qty_needed"] == "0.3"
    assert need["qty_target"] == "0.3"
    assert need["reserved"] == "0.3"
    assert need["status"] == "open"


async def test_external_needs_whole_sum_has_no_trailing_zero(client: AsyncClient) -> None:
    headers = await _external_key()
    await _shelter()
    for point in ("gym", "clinic"):
        await _row(
            f"SH001:item_master:rice@{point}",
            item_id="item_master:rice",
            drop_off_point_id=point,
            qty_needed=Decimal("10"),
            qty_target=Decimal("50"),
        )

    res = await client.get("/external/v1/needs", headers=headers)

    (need,) = res.json()["shelters"][0]["needs"]
    assert need["qty_needed"] == "20"
    assert need["qty_target"] == "100"
