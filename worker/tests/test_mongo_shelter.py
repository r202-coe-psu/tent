"""Tests for `apply_shelter_deactivate` — the true archive/delete signal handler.

Per the partner ODT (B_Data_We_Request_From_Partner_Systems, "Soft Delete"): a genuine
CouchDB delete/archive must never hard-delete the `public_shelters` row — only flip
`is_active` to `False`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model import PublicShelter

from worker.mongo.shelter import apply_shelter_deactivate


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
