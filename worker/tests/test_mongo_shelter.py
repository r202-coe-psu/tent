"""Tests for `apply_shelter_deactivate` — the true archive/delete signal handler.

Per the partner ODT (B_Data_We_Request_From_Partner_Systems, "Soft Delete"): a genuine
CouchDB delete/archive must never hard-delete the `public_shelters` row — only flip
`is_active` to `False`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

from tent_model import PublicShelter

from worker.mongo.shelter import apply_shelter_deactivate, refresh_occupancy


async def test_apply_shelter_deactivate_flips_flag_without_deleting_row(
    db: None,
) -> None:
    await PublicShelter(
        id="SH900",
        shelter_code="SH900",
        name="ศูนย์ที่ถูกยกเลิก",
        status="closed",
        is_active=True,
        capacity=10,
        updated_at=datetime.now(UTC),
    ).insert()

    await apply_shelter_deactivate("SH900")

    reloaded = await PublicShelter.get("SH900")
    assert reloaded is not None, "row must never be hard-deleted"
    assert reloaded.is_active is False


async def test_apply_shelter_deactivate_is_idempotent(db: None) -> None:
    await PublicShelter(
        id="SH901",
        shelter_code="SH901",
        name="ศูนย์ที่ถูกยกเลิกแล้ว",
        status="closed",
        is_active=False,
        capacity=10,
        updated_at=datetime.now(UTC),
    ).insert()

    await apply_shelter_deactivate("SH901")

    reloaded = await PublicShelter.get("SH901")
    assert reloaded is not None
    assert reloaded.is_active is False


async def test_apply_shelter_deactivate_no_op_when_shelter_unknown(db: None) -> None:
    # No matching document — must not raise.
    await apply_shelter_deactivate("SH-DOES-NOT-EXIST")


# --- EXT-005: refresh_occupancy ---


async def test_refresh_occupancy_writes_total_and_breakdown(db: None) -> None:
    await PublicShelter(
        id="SH910",
        shelter_code="SH910",
        name="ศูนย์ทดสอบ occupancy",
        status="open",
        is_active=True,
        capacity=100,
        updated_at=datetime.now(UTC),
    ).insert()

    async def _docs(_database: str):
        for doc in (
            {
                "_id": "evacuee:1",
                "type": "evacuee",
                "gender": "male",
                "age": 70,
                "current_stay": {"status": "active"},
            },
            {
                "_id": "evacuee:2",
                "type": "evacuee",
                "gender": "female",
                "current_stay": {"status": "checked_out"},
            },
            {
                "_id": "evacuee:3",
                "type": "evacuee",
                "gender": None,
                "current_stay": {"status": "active"},
            },
            {
                "_id": "evacuee:4",
                "type": "evacuee",
                "gender": "other",
                "current_stay": {"status": "active"},
            },
        ):
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = _docs

    assert await refresh_occupancy(couch, "SH910") is True

    reloaded = await PublicShelter.get("SH910")
    assert reloaded is not None
    assert reloaded.occupancy_total == 3
    assert reloaded.occupancy_breakdown.male == 1
    assert reloaded.occupancy_breakdown.elderly_over_60 == 1
    assert reloaded.occupancy_breakdown.female == 0
    # null + legacy 'other' → ไม่ระบุเพศ; gender groups partition the total
    assert reloaded.occupancy_breakdown.gender_unspecified == 2
    assert (
        reloaded.occupancy_breakdown.male
        + reloaded.occupancy_breakdown.female
        + reloaded.occupancy_breakdown.gender_unspecified
        == reloaded.occupancy_total
    )


async def test_refresh_occupancy_counts_every_stay_status_including_search_excluded(
    db: None,
) -> None:
    """PDPA D8: `occupancy_by_status` counts evacuees the person projection drops."""
    await PublicShelter(
        id="SH912",
        shelter_code="SH912",
        name="ศูนย์ทดสอบ occupancy_by_status",
        status="open",
        is_active=True,
        capacity=100,
        updated_at=datetime.now(UTC),
    ).insert()

    async def _docs(_database: str):
        for doc in (
            {
                "_id": "evacuee:1",
                "type": "evacuee",
                "current_stay": {"status": "active"},
            },
            {
                "_id": "evacuee:2",
                "type": "evacuee",
                "privacy": {"search_excluded": True},
                "current_stay": {"status": "room_confirmed"},
            },
            {
                "_id": "evacuee:3",
                "type": "evacuee",
                "privacy": {"search_excluded": True},
                "current_stay": {"status": "pre_registered"},
            },
        ):
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = _docs

    assert await refresh_occupancy(couch, "SH912") is True

    reloaded = await PublicShelter.get("SH912")
    assert reloaded is not None
    assert reloaded.occupancy_by_status == {
        "active": 1,
        "room_confirmed": 1,
        "pre_registered": 1,
    }
    # EXT-005 semantics unchanged: `active` only.
    assert reloaded.occupancy_total == 1


async def test_refresh_occupancy_no_op_when_shelter_row_missing(db: None) -> None:
    couch = AsyncMock()
    assert await refresh_occupancy(couch, "SH-DOES-NOT-EXIST") is False
    couch.database_exists.assert_not_called()


async def test_refresh_occupancy_no_op_when_shelter_database_missing(db: None) -> None:
    await PublicShelter(
        id="SH911",
        shelter_code="SH911",
        name="ศูนย์ไม่มี database",
        status="open",
        is_active=True,
        capacity=10,
        updated_at=datetime.now(UTC),
    ).insert()

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=False)

    assert await refresh_occupancy(couch, "SH911") is False


async def test_delete_jobs_for_shelter_drops_only_that_shelters_postings(
    db: None,
) -> None:
    """Cancelled shelter (draft-shelter-cancelled-status.md): its postings leave the
    volunteer board; another shelter's stay."""
    from tent_model.public_job import PublicJob

    from worker.mongo.job import delete_jobs_for_shelter

    collection = PublicJob.get_pymongo_collection()
    await collection.insert_one({"_id": "gone", "shelter_code": "SH910"})
    await collection.insert_one({"_id": "kept", "shelter_code": "SH911"})

    await delete_jobs_for_shelter("SH910")

    assert [row["_id"] async for row in collection.find({})] == ["kept"]


async def test_projected_shelter_status(db: None) -> None:
    from worker.mongo.shelter import projected_shelter_status

    await PublicShelter(
        id="SH920",
        shelter_code="SH920",
        name="ศูนย์ที่เปิด",
        status="open",
        is_active=True,
        capacity=10,
        updated_at=datetime.now(UTC),
    ).insert()

    assert await projected_shelter_status("SH920") == "open"
    assert await projected_shelter_status("SH921") is None
