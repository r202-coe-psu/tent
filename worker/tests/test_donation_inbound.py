"""Timestamps on public donations copied from Mongo into CouchDB."""

import itertools
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from tent_model import (
    DonationBuffer,
    DonationNeedCounter,
    DonorBuffer,
    counter_id,
    release_quota,
    reserve_quota,
    seed_counter,
)

from worker.inbound.donations import (
    _persist_donation,
    auto_approved_lines,
    campaign_auto_approve_audit_id,
)
from worker.masking import sha256_hex
from worker.quota.settle import settle_donation_quota
from worker.timeutil import iso_utc


def test_iso_utc_reads_a_naive_datetime_as_utc():
    # What PyMongo returns without tz_aware: UTC, but no offset attached.
    naive = datetime(2026, 9, 25, 21, 20, 18, 908000)
    assert iso_utc(naive) == "2026-09-25T21:20:18.908Z"


def test_iso_utc_converts_an_aware_datetime_to_utc():
    bangkok = timezone(timedelta(hours=7))
    assert (
        iso_utc(datetime(2026, 9, 26, 4, 20, 18, tzinfo=bangkok))
        == "2026-09-25T21:20:18.000Z"
    )
    assert (
        iso_utc(datetime(2026, 9, 25, 21, 20, 18, tzinfo=UTC))
        == "2026-09-25T21:20:18.000Z"
    )


_SEQ = itertools.count(1)


async def _row(**overrides: Any) -> DonationBuffer:
    """Insert an unsynced buffer row — inbound re-reads and CASes it in Mongo."""
    n = next(_SEQ)
    phone = overrides.pop("phone", "0810000000")
    fields: dict[str, Any] = {
        "id": f"donation:01TESTDONATION{n:012d}",
        "shelter_code": "SH001",
        "donor": DonorBuffer(name="ทดสอบ", phone=phone),
        "booking_ref": f"DN-{n:06d}",
        "tracking_token": f"TX-SH001-{n:08d}",
        "tracking_token_hash": f"hash-{n}",
        "status": "pending_review",
        "synced_to_couch": False,
        "created_at": datetime(2026, 9, 25, 21, 20, 18, 908000),
        "expires_at": datetime(2026, 9, 28, 21, 20, 18, 908000),
    }
    fields.update(overrides)
    return await DonationBuffer(**fields).insert()


async def _stored(row: DonationBuffer) -> DonationBuffer:
    stored = await DonationBuffer.get(row.id)
    assert stored is not None
    return stored


Hook = Callable[[], Awaitable[None]]


def _couch(
    bulk_rows=None,
    *,
    before_put: dict[int, Hook] | None = None,
    after_put: dict[int, Hook] | None = None,
    put_errors: dict[int, Exception] | None = None,
):
    """A CouchDB stand-in that hands out ``{n}-x`` revs; hooks run around the n-th PUT.

    ``before_put`` / ``after_put`` inject what a donor does through FastAPI while inbound
    is mid-sync; ``put_errors`` makes the n-th PUT raise.
    """
    couch = MagicMock()
    calls = {"n": 0}
    couch.database_exists = AsyncMock(return_value=True)

    async def put_doc(database, doc, **kwargs):
        calls["n"] += 1
        n = calls["n"]
        if before_put and n in before_put:
            await before_put[n]()
        if put_errors and n in put_errors:
            raise put_errors[n]
        if after_put and n in after_put:
            await after_put[n]()
        return {"ok": True, "id": doc["_id"], "rev": f"{n}-x"}

    async def get_doc(database, doc_id):
        return {"_id": doc_id, "_rev": f"{calls['n']}-x"}

    couch.put_doc = AsyncMock(side_effect=put_doc)
    couch.get_doc = AsyncMock(side_effect=get_doc)
    couch.bulk_docs = AsyncMock(return_value=bulk_rows or [{"id": "x", "rev": "1-a"}])
    return couch


async def _persisted_doc(donation: DonationBuffer) -> dict:
    couch = _couch()
    assert await _persist_donation(couch, donation) is True
    return couch.put_doc.await_args.args[1]


@pytest.mark.asyncio
async def test_persisted_donation_timestamps_carry_z_when_mongo_returns_naive(db: None):
    doc = await _persisted_doc(await _row())
    assert doc["created_at"] == "2026-09-25T21:20:18.908Z"
    assert doc["declared_at"] == "2026-09-25T21:20:18.908Z"
    assert doc["expires_at"] == "2026-09-28T21:20:18.908Z"
    assert doc["updated_at"].endswith("Z")


@pytest.mark.asyncio
@pytest.mark.parametrize("phone", ["0812345678", "081-234-5678", "+66812345678"])
async def test_phone_hash_is_of_the_normalized_number(db: None, phone: str):
    """CR-173 FR-13 — every way of writing one number hashes alike, as the backend does."""
    doc = await _persisted_doc(await _row(phone=phone))
    assert doc["donor"]["phone_hash"] == sha256_hex("0812345678")
    # The number itself is copied as typed; only the hash is normalized.
    assert doc["donor"]["phone"] == phone


_RICE = {
    "item_id": "item:rice",
    "free_text": "ข้าวสาร",
    "qty": "5",
    "unit": "kg",
    "reserved_qty": "5",
    "review_status": "approved",
    "line_key": "01K8TESTRICE00000000000000",
}
_BLANKET = {
    "free_text": "ผ้าห่ม",
    "qty": "2",
    "unit": "ผืน",
    "review_status": "pending",
    "line_key": "01K8TESTBLANKET00000000000",
}


@pytest.mark.asyncio
async def test_persisted_donation_is_stamped_schema_v10(db: None):
    # CR-206: items[].drop_off_point_id (9 was CR-175 donor photos, 8 CR-196's
    # items[].line_key). Must match the walk-in writer in the frontend — both channels
    # write the same version.
    couch = _couch()

    row = await _row()
    assert await _persist_donation(couch, row) is True
    doc = couch.put_doc.await_args.args[1]
    assert doc["_id"] == row.id
    assert doc["schema_v"] == 10
    # Nothing is rejected at intake — the fields only appear once staff review it.
    assert "reject_reason" not in doc
    assert "reject_reason_code" not in doc


@pytest.mark.asyncio
async def test_persisted_donation_carries_each_lines_drop_off_point(db: None):
    """CR-206 FR-MP-1 — the point FastAPI kept per line reaches CouchDB; no receipts yet."""
    doc = await _persisted_doc(
        await _row(
            items_declared=[
                {**_RICE, "drop_off_point_id": "01JGYM000000000000000000GY"},
                _BLANKET,
            ]
        )
    )

    assert [line.get("drop_off_point_id") for line in doc["items"]] == [
        "01JGYM000000000000000000GY",
        None,
    ]
    assert "point_receipts" not in doc


@pytest.mark.asyncio
async def test_persisted_donation_carries_the_line_review_and_status(db: None):
    couch = _couch()
    row = await _row(items_declared=[_RICE, _BLANKET], status="pending_review")

    assert await _persist_donation(couch, row) is True
    doc = couch.put_doc.await_args.args[1]
    assert doc["status"] == "pending_review"
    assert [i["review_status"] for i in doc["items"]] == ["approved", "pending"]
    # CR-196: the keys the donor's edit form names lines by.
    assert [i["line_key"] for i in doc["items"]] == [
        _RICE["line_key"],
        _BLANKET["line_key"],
    ]


@pytest.mark.asyncio
async def test_an_auto_approved_booking_gets_a_system_audit(db: None):
    """CR-174 FR-26 / AC-12."""
    couch = _couch()
    row = await _row(
        items_declared=[_BLANKET, _RICE],
        status="pending_review",
    )

    assert await _persist_donation(couch, row) is True

    database, docs = couch.bulk_docs.await_args.args
    assert database == "shelter_sh001"
    (audit,) = docs
    assert audit["_id"] == campaign_auto_approve_audit_id(row.id)
    assert audit["type"] == "audit"
    assert audit["schema_v"] == 1
    assert audit["action"] == "manual_adjust"
    assert audit["target_type"] == "donation"
    assert audit["target_id"] == row.id
    assert audit["created_by"] == "system"
    assert audit["shelter_code"] == "SH001"
    assert audit["context"]["approved_by"] == "system"
    assert audit["context"]["rule"] == "campaign_line"
    assert audit["context"]["lines"] == [1]
    assert audit["reason"]
    assert audit["occurred_at"] == audit["created_at"]


@pytest.mark.asyncio
async def test_no_audit_when_no_line_was_approved(db: None):
    couch = _couch()
    row = await _row(items_declared=[_BLANKET])

    assert await _persist_donation(couch, row) is True
    couch.bulk_docs.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_rerun_does_not_record_the_approval_twice(db: None):
    """Inbound may run a row again — the fixed id makes CouchDB refuse the copy."""
    couch = _couch(
        bulk_rows=[
            {
                "id": "audit:x",
                "error": "conflict",
                "reason": "Document update conflict.",
            }
        ]
    )
    row = await _row(items_declared=[_RICE], status="verifying")

    assert await _persist_donation(couch, row) is True
    couch.put_doc.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_failed_donation_write_records_no_approval(db: None):
    """Review #783 M5 — an audit written ahead of a PUT that fails names lines the donor
    may still change; the next poll's copy then hits the fixed id and is dropped."""
    couch = _couch()
    couch.put_doc = AsyncMock(side_effect=RuntimeError("couch down"))
    row = await _row(items_declared=[_RICE], status="verifying")

    assert await _persist_donation(couch, row) is False
    couch.bulk_docs.assert_not_awaited()
    assert (await _stored(row)).synced_to_couch is False


@pytest.mark.asyncio
async def test_a_failed_audit_is_logged_and_the_donation_still_lands(db: None, caplog):
    """Once the donation is in CouchDB a re-run cannot PUT it again, so holding the row
    back would strand it; the lost audit is logged instead."""
    couch = _couch(bulk_rows=[{"id": "audit:x", "error": "forbidden", "reason": "no"}])
    row = await _row(items_declared=[_RICE], status="verifying")

    assert await _persist_donation(couch, row) is True
    couch.put_doc.assert_awaited_once()
    assert (await _stored(row)).synced_to_couch is True
    assert "auto-approve audit" in caplog.text


def test_the_audit_id_is_stable_and_ulid_shaped():
    first = campaign_auto_approve_audit_id("donation:01ABC")
    assert first == campaign_auto_approve_audit_id("donation:01ABC")
    assert first != campaign_auto_approve_audit_id("donation:01ABD")
    suffix = first.removeprefix("audit:")
    assert len(suffix) == 26
    assert set(suffix) <= set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    # Same SHA-256 → Crockford encoding as the frontend's deriveDeterministicLedgerId.
    assert first == "audit:P9X7KHZ26EZ8WVMNCF3K9PFG9R"


def test_auto_approved_lines_counts_only_approved_lines():
    assert auto_approved_lines([_BLANKET, _RICE, {"qty": "1"}, _RICE]) == [1, 3]


# --- Races between the sync and the donor's FastAPI routes -------------------------

SHELTER = "SH001"
CAMPAIGN = "donation_campaign:01"
_BOOKED_RICE = {**_RICE, "qty": "6", "reserved_qty": "6"}
_EDITABLE = ["declared", "pending_review", "verifying"]


async def _reserved() -> Decimal:
    counter = await DonationNeedCounter.get(counter_id(SHELTER, CAMPAIGN, "item:rice"))
    assert counter is not None
    return counter.reserved_qty


async def _booked_row(**overrides: Any) -> DonationBuffer:
    """A booking holding 6 kg of rice against a seeded counter, as ``create`` leaves it."""
    now = datetime.now(UTC)
    await seed_counter(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty_target=Decimal(50),
        now=now,
    )
    await reserve_quota(
        shelter_code=SHELTER,
        campaign_id=CAMPAIGN,
        item_id="item:rice",
        qty=Decimal(6),
        now=now,
    )
    fields: dict[str, Any] = {
        "campaign_id": CAMPAIGN,
        "items_declared": [_BOOKED_RICE],
    }
    fields.update(overrides)
    return await _row(**fields)


def _donor_cancel(row: DonationBuffer) -> Hook:
    """``DonationsUseCase.cancel``: CAS on unsynced + editable, then give the quota back."""

    async def cancel() -> None:
        before = await DonationBuffer.get_pymongo_collection().find_one_and_update(
            {
                "_id": row.id,
                "synced_to_couch": False,
                "status": {"$in": _EDITABLE},
            },
            {"$set": {"status": "cancelled"}},
        )
        assert before is not None, "the donor's cancel must win the race"
        for item in before["items_declared"]:
            await release_quota(
                shelter_code=SHELTER,
                campaign_id=CAMPAIGN,
                item_id=item["item_id"],
                qty=Decimal(item["reserved_qty"]),
                now=datetime.now(UTC),
            )

    return cancel


def _donor_edit(row: DonationBuffer, items: list[dict[str, Any]]) -> Hook:
    """``update_items``: new lines and status, one more revision."""

    async def edit() -> None:
        await DonationBuffer.get_pymongo_collection().update_one(
            {"_id": row.id, "synced_to_couch": False},
            {
                "$set": {"items_declared": items, "status": "verifying"},
                "$push": {"revisions": {"at": "2026-10-28T00:00:00.000Z"}},
            },
        )

    return edit


def _donor_courier(row: DonationBuffer, tracking_no: str) -> Hook:
    """``update_courier_tracking``: rewrites ``logistics`` whole."""

    async def courier() -> None:
        await DonationBuffer.get_pymongo_collection().update_one(
            {"_id": row.id, "synced_to_couch": False},
            {
                "$set": {
                    "logistics": {
                        "method": "courier",
                        "courier_tracking_no": tracking_no,
                    }
                }
            },
        )

    return courier


@pytest.mark.asyncio
@pytest.mark.parametrize("logistics", [None, {"method": "courier"}])
async def test_an_undisturbed_sync_is_one_put_and_one_flip(db: None, logistics):
    """A missing ``logistics`` / tracking number is the fingerprint too (null matches)."""
    couch = _couch()
    row = await _row(logistics=logistics)

    assert await _persist_donation(couch, row) is True

    couch.put_doc.assert_awaited_once()
    assert (await _stored(row)).synced_to_couch is True


@pytest.mark.asyncio
@pytest.mark.parametrize("window", ["before_put", "after_put"])
async def test_a_donor_cancel_in_the_sync_window_is_not_reverted(db: None, window: str):
    row = await _booked_row()
    hooks = {1: _donor_cancel(row)}
    couch = _couch(**{window: hooks})

    assert await _persist_donation(couch, row) is True

    first, second = couch.put_doc.await_args_list
    assert first.args[1]["status"] == "pending_review"
    assert "retry_conflict" not in first.kwargs
    # Corrected in place on top of our own revision, never by overwriting blindly.
    assert second.args[1]["status"] == "cancelled"
    assert second.args[1]["_rev"] == "1-x"
    assert second.kwargs["retry_conflict"] is False
    stored = await _stored(row)
    assert (stored.status, stored.synced_to_couch) == ("cancelled", True)
    # Released once by the cancel; the catch-up and a replayed change add nothing.
    assert await _reserved() == Decimal(0)
    doc = {"tracking_token_hash": row.tracking_token_hash, "status": "cancelled"}
    assert await settle_donation_quota(doc, now=datetime.now(UTC)) == Decimal(0)
    assert await _reserved() == Decimal(0)


@pytest.mark.asyncio
async def test_a_donor_item_edit_in_the_sync_window_is_carried_across(db: None):
    row = await _row(items_declared=[_BLANKET], status="pending_review")
    new_items = [_BLANKET, {**_RICE, "qty": "9"}]
    couch = _couch(after_put={1: _donor_edit(row, new_items)})

    assert await _persist_donation(couch, row) is True

    first, second = couch.put_doc.await_args_list
    assert first.args[1]["items"] == [_BLANKET]
    assert second.args[1]["items"] == new_items
    assert second.args[1]["status"] == "verifying"
    assert len(second.args[1]["revisions"]) == 1
    # Only the lines actually synced, and only once.
    couch.bulk_docs.assert_awaited_once()
    (audit,) = couch.bulk_docs.await_args.args[1]
    assert audit["context"]["lines"] == [1]
    stored = await _stored(row)
    assert (stored.items_declared, stored.synced_to_couch) == (new_items, True)


@pytest.mark.asyncio
async def test_a_donor_courier_edit_in_the_sync_window_is_carried_across(db: None):
    row = await _row(logistics={"method": "courier"})
    couch = _couch(after_put={1: _donor_courier(row, "TH123456")})

    assert await _persist_donation(couch, row) is True

    first, second = couch.put_doc.await_args_list
    assert "courier_tracking_no" not in first.args[1]["logistics"]
    assert second.args[1]["logistics"]["courier_tracking_no"] == "TH123456"
    assert (await _stored(row)).synced_to_couch is True


@pytest.mark.asyncio
async def test_a_third_party_write_stops_the_resync(db: None, caplog):
    """The strict re-PUT meets a document someone else wrote: leave it, do not overwrite."""
    row = await _booked_row()
    conflict = httpx.HTTPStatusError(
        "409",
        request=httpx.Request("PUT", "http://x"),
        response=httpx.Response(409, request=httpx.Request("PUT", "http://x")),
    )
    couch = _couch(after_put={1: _donor_cancel(row)}, put_errors={2: conflict})

    with caplog.at_level(logging.ERROR):
        assert await _persist_donation(couch, row) is False

    assert couch.put_doc.await_count == 2
    assert (await _stored(row)).synced_to_couch is False
    assert "changed while donation" in caplog.text
    couch.bulk_docs.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_row_that_keeps_changing_is_left_for_the_next_poll(db: None):
    row = await _row(items_declared=[_BLANKET])
    couch = _couch(after_put={n: _donor_courier(row, f"TH{n}") for n in range(1, 5)})

    assert await _persist_donation(couch, row) is False

    assert couch.put_doc.await_count == 4  # one PUT, three re-PUTs
    assert (await _stored(row)).synced_to_couch is False


@pytest.mark.asyncio
async def test_a_row_cancelled_and_purged_meanwhile_is_skipped(db: None):
    row = await _row()
    await DonationBuffer.get_pymongo_collection().delete_one({"_id": row.id})
    couch = _couch()

    assert await _persist_donation(couch, row) is False
    couch.put_doc.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_couch_cancel_before_the_flip_is_settled_after_it(db: None):
    """Settle ignores an unsynced buffer, so inbound must catch up on the CouchDB doc."""
    row = await _booked_row()
    doc = {
        "_id": row.id,
        "_rev": "9-z",
        "tracking_token_hash": row.tracking_token_hash,
        "status": "cancelled",
    }

    async def feed_during_window() -> None:
        # The change feed delivers the cancel before the flag is flipped: ignored.
        assert await settle_donation_quota(doc, now=datetime.now(UTC)) == Decimal(0)

    couch = _couch(after_put={1: feed_during_window})
    couch.get_doc = AsyncMock(return_value=doc)

    assert await _persist_donation(couch, row) is True

    assert await _reserved() == Decimal(0)
    assert (await _stored(row)).status == "cancelled"
    # The feed delivering it again changes nothing.
    assert await settle_donation_quota(doc, now=datetime.now(UTC)) == Decimal(0)
    assert await _reserved() == Decimal(0)
