"""Tests for `refresh_shelter_stock` (EXT-004/006)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

from tent_model import PublicShelter, ShelterStock

from worker.mongo.stock import refresh_shelter_stock


def _fake_couch(shelter_docs: list[dict], catalog_docs: list[dict] | None = None):
    async def _docs(database: str):
        source = (
            catalog_docs
            if database == "catalog" and catalog_docs is not None
            else shelter_docs
        )
        for doc in source:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = _docs
    return couch


async def test_refresh_shelter_stock_writes_balances_and_type_code(db: None) -> None:
    couch = _fake_couch(
        shelter_docs=[
            {
                "_id": "stock_ledger:1",
                "type": "stock_ledger",
                "item_id": "item_master:rice",
                "qty": "480",
            },
        ],
        catalog_docs=[
            {
                "_id": "item_master:rice",
                "type": "item_master",
                "name": "ข้าวสาร",
                "category": "food",
                "base_unit": "กก.",
                "sku": "GEN-005",
            },
        ],
    )

    count = await refresh_shelter_stock(couch, "SH920")
    assert count == 1

    row = await ShelterStock.get("SH920:item_master:rice")
    assert row is not None
    assert row.quantity_on_hand == 480.0
    assert row.type_code == "food"
    assert row.unit_label == "กก."
    assert row.m6_item_code == "GEN-005"
    assert row.m6_reference_id is None
    assert row.source == "direct_donation"


async def test_refresh_shelter_stock_reads_occupancy_for_reorder_threshold(
    db: None,
) -> None:
    await PublicShelter(
        id="SH921",
        shelter_code="SH921",
        name="ศูนย์ทดสอบ stock",
        status="open",
        is_active=True,
        capacity=100,
        occupancy_total=100,
        updated_at=datetime.now(UTC),
    ).insert()

    couch = _fake_couch(
        shelter_docs=[
            {
                "_id": "stock_ledger:1",
                "type": "stock_ledger",
                "item_id": "item_master:water",
                "qty": "1000",
            },
            {
                "_id": "stock_threshold_override:SH921:item_master:water",
                "type": "stock_threshold_override",
                "item_id": "item_master:water",
                "reorder_level": None,
                "consumption_rate": "3",
                "target_reserve_days": 2,
            },
        ],
        catalog_docs=[
            {
                "_id": "item_master:water",
                "type": "item_master",
                "name": "น้ำดื่ม",
                "category": "food",
                "base_unit": "ขวด",
            },
        ],
    )

    await refresh_shelter_stock(couch, "SH921")

    row = await ShelterStock.get("SH921:item_master:water")
    assert row is not None
    # 100 occupants * 3/day * 2 days = 600
    assert row.reorder_threshold == 600.0


async def test_refresh_shelter_stock_uses_local_item_master_when_not_in_catalog(
    db: None,
) -> None:
    """item_master created per-shelter (never in the central `catalog` DB) must still
    resolve name/type/unit — mirrors frontend's central+local merge (catalog.remote.ts)."""
    couch = _fake_couch(
        shelter_docs=[
            {
                "_id": "stock_ledger:1",
                "type": "stock_ledger",
                "item_id": "item_master:01M2355XTPRRPJGP40225P4B5B",
                "qty": "111",
            },
            {
                "_id": "item_master:01M2355XTPRRPJGP40225P4B5B",
                "type": "item_master",
                "name": "จาน",
                "category": "genaral",
                "base_unit": "ชิ้น",
                "shelter_code": "SH922",
            },
        ],
        catalog_docs=[],
    )

    count = await refresh_shelter_stock(couch, "SH922")
    assert count == 1

    row = await ShelterStock.get("SH922:item_master:01M2355XTPRRPJGP40225P4B5B")
    assert row is not None
    assert row.name_th == "จาน"
    assert row.unit_label == "ชิ้น"
    assert row.quantity_on_hand == 111.0


async def test_refresh_shelter_stock_local_item_master_overrides_central(
    db: None,
) -> None:
    couch = _fake_couch(
        shelter_docs=[
            {
                "_id": "stock_ledger:1",
                "type": "stock_ledger",
                "item_id": "item_master:rice",
                "qty": "10",
            },
            {
                "_id": "item_master:rice",
                "type": "item_master",
                "name": "ข้าวสาร (ศูนย์นี้)",
                "category": "food",
                "base_unit": "กก.",
                "shelter_code": "SH923",
            },
        ],
        catalog_docs=[
            {
                "_id": "item_master:rice",
                "type": "item_master",
                "name": "ข้าวสาร",
                "category": "food",
                "base_unit": "กก.",
                "sku": "GEN-005",
            },
        ],
    )

    await refresh_shelter_stock(couch, "SH923")

    row = await ShelterStock.get("SH923:item_master:rice")
    assert row is not None
    assert row.name_th == "ข้าวสาร (ศูนย์นี้)"


async def test_refresh_shelter_stock_skips_a_shelter_with_no_database(db: None) -> None:
    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=False)

    assert await refresh_shelter_stock(couch, "SH-DOES-NOT-EXIST") == 0
