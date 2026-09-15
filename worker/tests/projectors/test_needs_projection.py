"""`public_needs` projection — what the donor-facing board is actually allowed to see.

The board is an aggregate per ITEM (schema.md §2.4 / T-60): two campaigns asking for
`item:water` produce one card whose quantity is their sum, named from the catalog. The
campaign's own title and notes never cross to the public plane.

`visible_on_home` is the back-office toggle (CR-034) and this projection is the only
public surface reading campaign needs — so hiding a campaign has to take effect here.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from worker.projectors.needs import project_needs_for_shelter

SHELTER = "SH001"

CATALOG = [
    {
        "_id": "item:water",
        "type": "supply_item",
        "name": "น้ำดื่ม",
        "category": "water",
        "unit": "bottle",
    },
    # `item_master` replaced `supply_item` (schema.md §4.2) but the migration has not
    # run, so the catalog carries both generations and a campaign may bind to either.
    {
        "_id": "item_master:canned-fish",
        "type": "item_master",
        "name": "ปลากระป๋อง",
        "category": "food",
        "base_unit": "can",
    },
    {
        "_id": "item_master:retired",
        "type": "item_master",
        "name": "เลิกใช้",
        "base_unit": "ชิ้น",
        "deactivated": True,
    },
]


def _couch(campaigns: list[dict], donations: list[dict] | None = None) -> AsyncMock:
    shelter_docs = [*campaigns, *(donations or [])]

    async def iter_all_docs(database: str):
        for doc in CATALOG if database == "catalog" else shelter_docs:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs
    return couch


def _campaign(campaign_id: str, qty_target: str, **over) -> dict:
    return {
        "_id": f"donation_campaign:{campaign_id}",
        "type": "donation_campaign",
        "status": "open",
        "title": f"ประกาศ {campaign_id}",
        "needs": [{"item_id": "item:water", "qty_target": qty_target, "unit": "ขวด"}],
        **over,
    }


def _upserts(actions: list[tuple[str, dict | None]]) -> list[dict]:
    return [doc for action, doc in actions if action == "upsert" and doc]


def _deletes(actions: list[tuple[str, dict | None]]) -> list[dict]:
    return [doc for action, doc in actions if action == "delete" and doc]


@pytest.mark.asyncio
async def test_two_campaigns_for_one_item_become_one_summed_card():
    actions = await project_needs_for_shelter(
        _couch([_campaign("a", "100"), _campaign("b", "999")]), SHELTER
    )

    docs = _upserts(actions)
    assert len(docs) == 1
    assert docs[0]["_id"] == f"{SHELTER}:item:water"
    assert docs[0]["qty_needed"] == 1099.0


@pytest.mark.asyncio
async def test_card_is_named_from_the_catalog_not_the_campaign():
    actions = await project_needs_for_shelter(
        _couch([_campaign("a", "100", title="น้ำ")]), SHELTER
    )

    doc = _upserts(actions)[0]
    assert doc["item_name"] == "น้ำดื่ม"
    assert doc["unit"] == "bottle"
    assert doc["category"] == "water"
    # The campaign's own title/notes are back-office copy and stay there.
    assert "title" not in doc


@pytest.mark.asyncio
async def test_hidden_campaign_is_kept_off_the_public_board():
    actions = await project_needs_for_shelter(
        _couch([_campaign("a", "100", visible_on_home=False)]), SHELTER
    )

    assert _upserts(actions) == []
    assert [d["_id"] for d in _deletes(actions)] == []


@pytest.mark.asyncio
async def test_hiding_one_campaign_leaves_the_other_visible_with_its_own_total():
    actions = await project_needs_for_shelter(
        _couch([_campaign("a", "100"), _campaign("b", "999", visible_on_home=False)]),
        SHELTER,
    )

    docs = _upserts(actions)
    assert len(docs) == 1
    assert docs[0]["qty_needed"] == 100.0


@pytest.mark.asyncio
async def test_missing_flag_means_visible_so_old_campaigns_need_no_backfill():
    campaign = _campaign("a", "100")
    assert "visible_on_home" not in campaign

    actions = await project_needs_for_shelter(_couch([campaign]), SHELTER)

    assert len(_upserts(actions)) == 1


@pytest.mark.asyncio
async def test_closed_campaign_stays_off_the_board():
    actions = await project_needs_for_shelter(
        _couch([_campaign("a", "100", status="closed")]), SHELTER
    )

    assert _upserts(actions) == []


# The donor board draws its progress bar from these three terms. They used to be
# invented in the component (`target = qty × 2`, `received = target − qty`,
# `reserved = 0`), so every card showed the same 50% and "จองไว้ 0".
@pytest.mark.asyncio
async def test_projection_publishes_the_terms_behind_the_shortage():
    donation = {
        "_id": "donation:booked",
        "type": "donation",
        "status": "pending_review",
        "campaign_id": "donation_campaign:a",
        "items": [{"item_id": "item:water", "qty": "30", "unit": "bottle"}]
    }
    ledger = {
        "_id": "stock_ledger:on-shelf",
        "type": "stock_ledger",
        "item_id": "item:water",
        "qty": "20",
        "reason": "purchase"
    }
    couch = _couch([_campaign("a", "100")], [donation, ledger])

    doc = _upserts(await project_needs_for_shelter(couch, SHELTER))[0]

    assert doc["qty_target"] == 100.0
    assert doc["on_hand"] == 20.0
    assert doc["reserved"] == 30.0
    # The published shortage is exactly what the terms say it is.
    assert doc["qty_needed"] == doc["qty_target"] - doc["on_hand"] - doc["reserved"]


@pytest.mark.asyncio
async def test_terms_sum_across_campaigns_asking_for_the_same_item():
    couch = _couch([_campaign("a", "100"), _campaign("b", "50")])

    doc = _upserts(await project_needs_for_shelter(couch, SHELTER))[0]

    assert doc["qty_target"] == 150.0
    assert doc["reserved"] == 0.0


@pytest.mark.asyncio
async def test_a_hand_closed_need_announces_no_target():
    campaign = _campaign("a", "100")
    campaign["needs"][0]["status"] = "closed"
    # A second, open campaign keeps the item on the board at all.
    couch = _couch([campaign, _campaign("b", "40")])

    doc = _upserts(await project_needs_for_shelter(couch, SHELTER))[0]

    assert doc["qty_target"] == 40.0


# The donor board showed "item_master:canned-fish" with unit "unit" for anything bound
# to the newer catalog generation: the catalog map read `supply_item` only, and the
# document id stripped/re-added a hardcoded `item:` prefix so master ids came out
# doubled (`SH001:item:item_master:canned-fish`).


@pytest.mark.asyncio
async def test_item_master_need_is_named_from_the_catalog():
    campaign = _campaign("a", "50")
    campaign["needs"] = [
        {"item_id": "item_master:canned-fish", "qty_target": "50", "unit": "ลัง"}
    ]

    doc = _upserts(await project_needs_for_shelter(_couch([campaign]), SHELTER))[0]

    assert doc["item_name"] == "ปลากระป๋อง"
    assert doc["unit"] == "can"
    assert doc["category"] == "food"


@pytest.mark.asyncio
async def test_item_master_id_is_not_doubled_up():
    campaign = _campaign("a", "50")
    campaign["needs"] = [
        {"item_id": "item_master:canned-fish", "qty_target": "50", "unit": "ลัง"}
    ]

    doc = _upserts(await project_needs_for_shelter(_couch([campaign]), SHELTER))[0]

    assert doc["_id"] == f"{SHELTER}:item_master:canned-fish"


@pytest.mark.asyncio
async def test_legacy_item_id_keeps_its_existing_document_id():
    """The id scheme must not move for `item:` rows — they already exist in Mongo."""
    doc = _upserts(await project_needs_for_shelter(_couch([_campaign("a", "100")]), SHELTER))[0]

    assert doc["_id"] == f"{SHELTER}:item:water"


@pytest.mark.asyncio
async def test_deactivated_item_master_falls_back_instead_of_naming_the_card():
    campaign = _campaign("a", "50")
    campaign["needs"] = [{"item_id": "item_master:retired", "qty_target": "50", "unit": "ชิ้น"}]

    doc = _upserts(await project_needs_for_shelter(_couch([campaign]), SHELTER))[0]

    assert doc["item_name"] == "item_master:retired"
