"""Tests for the partner booking inbound loop (CR-154 C6, CR-169 C3/C4).

State tests run against the real test Mongo (``db`` fixture) because the point of the
worker's writes is that they are conditional on the row's current state — the API
mutates the same rows concurrently (EXT-009 cancel). A booking is a *group* of rows
sharing ``booking_id``; the worker writes it as one unit (FR-21, FR-34) and the
sweeper drops groups the API never finished committing (FR-33).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from tent_model import ExternalBooking

import worker.inbound.external_bookings as inbound
from worker.inbound.external_bookings import (
    BACKOFF_BASE_SECONDS,
    BACKOFF_MAX_SECONDS,
    HOLD_STATUSES,
    LOG_THROTTLE_SECONDS,
    FailureTracker,
    _find_due,
    _persist_group,
    _process_cancel,
    build_evacuee_doc,
    build_household_doc,
    partner_actor,
    sweep_stale_staged,
)

CID = "1103700012345"
PHONE = "0812345678"
DB = "shelter_sh001"
BOOKING_ID = "BK-01TEST"
PII = ("cid", "first_name", "last_name", "phone")
OLD = datetime(2026, 10, 6, tzinfo=UTC)


def _cid(index: int) -> str:
    return f"110370001{index:04d}"


async def _insert(**overrides) -> ExternalBooking:
    fields = {
        "id": BOOKING_ID,
        "booking_id": BOOKING_ID,
        "client_id": "client-abc",
        "module_name": "M2",
        "shelter_code": "SH001",
        "cid": CID,
        "cid_hash": "hash",
        "first_name": "สมชาย",
        "last_name": "ใจดี",
        "phone": PHONE,
        "state": "pending",
        "created_at": OLD,
        "updated_at": OLD,
    }
    fields.update(overrides)
    booking = ExternalBooking(**fields)
    await booking.insert()
    return booking


def _row_id(index: int) -> str:
    return f"BP-{index}"


async def _insert_group(size: int, **overrides) -> list[ExternalBooking]:
    """A committed group of `size` pending rows with distinct ids / CIDs / cid_hashes."""
    return [
        await _insert(
            id=_row_id(index),
            person_seq=index,
            group_size=size,
            cid=_cid(index),
            cid_hash=f"h{index}",
            first_name=f"ชื่อ{index}",
            last_name=f"สกุล{index}",
            phone=f"08000000{index:02d}",
            **overrides,
        )
        for index in range(size)
    ]


async def _row(row_id: str = BOOKING_ID) -> dict:
    row = await ExternalBooking.get_pymongo_collection().find_one({"_id": row_id})
    assert row is not None
    return row


async def _api_update(guard: dict, changes: dict, row_id: str = BOOKING_ID) -> None:
    """Simulate the API's guarded EXT-009 write on the raw collection."""
    result = await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": row_id, **guard}, {"$set": changes}
    )
    assert result.matched_count == 1


async def _api_cancel_pending(row_id: str = BOOKING_ID) -> None:
    await _api_update(
        {"state": "pending"},
        {
            "state": "cancelled",
            "cid": None,
            "first_name": None,
            "last_name": None,
            "phone": None,
            "cancel_reason": "partner cancel",
            "updated_at": datetime.now(UTC),
        },
        row_id,
    )


def _bulk_ok(_database, docs):
    return [{"ok": True, "id": doc["_id"], "rev": "1-x"} for doc in docs]


def _couch(*, exists=True, find=None, written=None, bulk=None, doc=None):
    """`find` = duplicate hits; `written` = hits for the "already in Couch?" id probe."""
    couch = MagicMock()
    couch.database_exists = AsyncMock(return_value=exists)

    async def _find(_database, selector, **_kwargs):
        if "$in" in selector.get("_id", {}):
            return written or []
        return find or []

    couch.find = AsyncMock(side_effect=_find)
    couch.bulk_docs = (
        AsyncMock(return_value=bulk)
        if bulk is not None
        else AsyncMock(side_effect=_bulk_ok)
    )
    couch.get_doc = AsyncMock(return_value=doc)
    couch.put_doc = AsyncMock(return_value={"ok": True})
    return couch


def _assert_pii_cleared(row: dict) -> None:
    for key in PII:
        assert row[key] is None, key


def _assert_no_pii_logged(text: str) -> None:
    for secret in (CID, PHONE, "สมชาย", "ใจดี", "110370001", "08000000", "ชื่อ", "สกุล"):
        assert secret not in text, secret


# ---------------------------------------------------------------- pure builders


def test_partner_actor_prefers_module_then_client():
    assert partner_actor("M2", "client-abc") == "partner:M2"
    assert partner_actor(None, "client-abc") == "partner:client-abc"
    assert partner_actor("", "client-abc") == "partner:client-abc"


def test_build_household_doc_shape():
    doc = build_household_doc(
        household_id="household:H1",
        evacuee_id="evacuee:E1",
        shelter_code="SH001",
        first_name="สมชาย",
        created_by="partner:M2",
        now="2026-10-06T00:00:00Z",
    )
    assert doc["_id"] == "household:H1"
    assert doc["type"] == "household"
    assert doc["schema_v"] == 6
    assert doc["label"] == "ครอบครัวสมชาย"
    assert doc["head_evacuee_id"] == "evacuee:E1"
    assert doc["status"] == "pre_registered"
    assert doc["pets"] == []
    assert doc["vehicles"] == []
    assert doc["created_by"] == "partner:M2"
    assert doc["created_at"] == doc["updated_at"] == "2026-10-06T00:00:00Z"


def test_build_evacuee_doc_shape():
    doc = build_evacuee_doc(
        evacuee_id="evacuee:E1",
        household_id="household:H1",
        shelter_code="SH001",
        cid=CID,
        first_name="สมชาย",
        last_name=None,
        phone=PHONE,
        booking_ref="BK-01TEST",
        created_by="partner:M2",
        now="2026-10-06T00:00:00Z",
    )
    assert doc["_id"] == "evacuee:E1"
    assert doc["type"] == "evacuee"
    assert doc["schema_v"] == 14
    assert doc["booking_ref"] == "BK-01TEST"
    assert doc["gender"] is None
    assert doc["last_name"] == ""
    assert doc["person_id"] == {"cardType": "national_id", "number": CID}
    assert doc["country"] == "THAILAND"
    assert doc["household_id"] == "household:H1"
    assert doc["current_stay"] == {
        "status": "pre_registered",
        "zone": None,
        "since": "2026-10-06T00:00:00Z",
    }
    assert doc["privacy"] == {"search_excluded": False}
    assert doc["registered_via"] == "api"
    assert doc["vulnerable_groups"] == []
    assert doc["special_needs"] == []


# ---------------------------------------------------------------- pending → written


async def test_pending_booking_written_and_pii_cleared(db):
    await _insert()
    couch = _couch()

    assert await _persist_group(couch, BOOKING_ID) is True

    row = await _row()
    assert row["evacuee_id"].startswith("evacuee:")
    assert row["household_id"].startswith("household:")
    selector = couch.find.await_args.args[1]
    assert selector["person_id.number"] == {"$in": [CID]}
    assert selector["current_stay.status"] == {"$in": list(HOLD_STATUSES)}
    assert selector["_id"] == {"$nin": [row["evacuee_id"]]}

    db_name, docs = couch.bulk_docs.await_args.args
    assert db_name == DB
    household, evacuee = docs
    assert household["type"] == "household"
    assert household["_id"] == row["household_id"]
    assert household["head_evacuee_id"] == row["evacuee_id"]
    assert evacuee["_id"] == row["evacuee_id"]
    assert evacuee["gender"] is None
    assert evacuee["registered_via"] == "api"
    assert evacuee["schema_v"] == 14
    assert evacuee["booking_ref"] == BOOKING_ID
    assert evacuee["person_id"]["number"] == CID
    assert evacuee["created_by"] == "partner:M2"
    assert household["created_by"] == "partner:M2"

    assert row["state"] == "written"
    assert row["cancel_requested"] is False
    _assert_pii_cleared(row)


async def test_group_of_three_written_with_shared_booking_ref(db, caplog):
    caplog.set_level(logging.INFO)
    await _insert_group(3)
    couch = _couch()

    assert await _persist_group(couch, BOOKING_ID) is True

    # One pre-check and one bulk write for the whole group.
    assert couch.find.await_count == 1
    assert couch.bulk_docs.await_count == 1
    selector = couch.find.await_args.args[1]
    assert selector["person_id.number"] == {"$in": [_cid(0), _cid(1), _cid(2)]}
    rows = [await _row(_row_id(i)) for i in range(3)]
    assert selector["_id"] == {"$nin": [r["evacuee_id"] for r in rows]}

    _, docs = couch.bulk_docs.await_args.args
    assert len(docs) == 6
    households = [d for d in docs if d["type"] == "household"]
    evacuees = [d for d in docs if d["type"] == "evacuee"]
    assert len(households) == len(evacuees) == 3
    assert {d["booking_ref"] for d in evacuees} == {BOOKING_ID}
    assert {d["schema_v"] for d in evacuees} == {14}
    assert [d["person_id"]["number"] for d in evacuees] == [_cid(0), _cid(1), _cid(2)]
    # 1 person = 1 household (no automatic merge — CR-169 D4).
    assert len({d["household_id"] for d in evacuees}) == 3
    for row, evacuee, household in zip(rows, evacuees, households, strict=True):
        assert evacuee["_id"] == row["evacuee_id"]
        assert household["_id"] == evacuee["household_id"] == row["household_id"]
        assert household["head_evacuee_id"] == evacuee["_id"]
        assert row["state"] == "written"
        _assert_pii_cleared(row)
    _assert_no_pii_logged(caplog.text)
    assert BOOKING_ID in caplog.text


async def test_no_module_falls_back_to_client_id(db):
    await _insert(module_name=None)
    couch = _couch()

    assert await _persist_group(couch, BOOKING_ID) is True
    _, docs = couch.bulk_docs.await_args.args
    assert {d["created_by"] for d in docs} == {"partner:client-abc"}


async def test_retry_reuses_reserved_ids(db):
    await _insert(evacuee_id="evacuee:E1", household_id="household:H1")
    couch = _couch()

    assert await _persist_group(couch, BOOKING_ID) is True
    _, docs = couch.bulk_docs.await_args.args
    assert [d["_id"] for d in docs] == ["household:H1", "evacuee:E1"]
    assert (await _row())["state"] == "written"


async def test_row_without_committed_key_is_written(db):
    """Rows written before CR-169 have no `committed` / group fields (group of one)."""
    await _insert()
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": BOOKING_ID},
        {"$unset": {"committed": "", "group_size": "", "person_seq": ""}},
    )
    couch = _couch()

    assert await _persist_group(couch, BOOKING_ID) is True
    assert (await _row())["state"] == "written"


async def test_missing_database_retries_later(db):
    await _insert()
    couch = _couch(exists=False)

    assert await _persist_group(couch, BOOKING_ID) is False
    row = await _row()
    assert row["state"] == "pending"
    assert row["cid"] == CID
    assert row["evacuee_id"] is None
    couch.bulk_docs.assert_not_awaited()


async def test_incomplete_group_never_touches_couch(db):
    """A row still `committed=False` means the API has not finished — skip the group."""
    await _insert_group(3)
    await _api_update({}, {"committed": False}, _row_id(2))
    couch = _couch()

    assert await _persist_group(couch, BOOKING_ID) is False

    couch.database_exists.assert_not_awaited()
    couch.find.assert_not_awaited()
    couch.bulk_docs.assert_not_awaited()
    for index in range(3):
        row = await _row(_row_id(index))
        assert row["state"] == "pending"
        assert row["cid"] == _cid(index)
        assert row["evacuee_id"] is None


async def test_group_with_missing_rows_never_touches_couch(db):
    """`group_size` says 3 but only 2 rows exist (e.g. a half-applied cleanup)."""
    await _insert_group(3)
    await ExternalBooking.get_pymongo_collection().delete_one({"_id": _row_id(1)})
    couch = _couch()

    assert await _persist_group(couch, BOOKING_ID) is False
    couch.find.assert_not_awaited()
    couch.bulk_docs.assert_not_awaited()


async def test_cancelled_before_reserve_never_touches_couch(db):
    await _insert()
    couch = _couch()

    async def api_cancels_after_poll_read(*_args):
        await _api_cancel_pending()
        return True

    couch.database_exists = AsyncMock(side_effect=api_cancels_after_poll_read)

    assert await _persist_group(couch, BOOKING_ID) is True

    couch.find.assert_not_awaited()
    couch.bulk_docs.assert_not_awaited()
    row = await _row()
    assert row["state"] == "cancelled"
    assert row["cancel_reason"] == "partner cancel"
    assert row["evacuee_id"] is None
    _assert_pii_cleared(row)


async def test_group_stops_when_one_row_cancelled_before_reserve(db):
    await _insert_group(3)
    couch = _couch()

    async def api_cancels_middle_row(*_args):
        await _api_cancel_pending(_row_id(1))
        return True

    couch.database_exists = AsyncMock(side_effect=api_cancels_middle_row)

    assert await _persist_group(couch, BOOKING_ID) is True

    couch.find.assert_not_awaited()
    couch.bulk_docs.assert_not_awaited()
    assert (await _row(_row_id(1)))["state"] == "cancelled"
    for index in (0, 2):
        row = await _row(_row_id(index))
        assert row["state"] == "pending"
        assert row["cid"] == _cid(index)


async def test_cancelled_during_write_is_routed_to_cancel(db):
    await _insert()
    couch = _couch()

    async def bulk_then_api_cancels(_database, docs):
        await _api_cancel_pending()
        return _bulk_ok(_database, docs)

    couch.bulk_docs = AsyncMock(side_effect=bulk_then_api_cancels)

    assert await _persist_group(couch, BOOKING_ID) is True

    row = await _row()
    assert row["state"] == "written"
    assert row["cancel_requested"] is True
    assert row["cancel_reason"] == "partner cancel"
    assert row["evacuee_id"].startswith("evacuee:")
    _assert_pii_cleared(row)


# ---------------------------------------------------------------- duplicates


async def test_duplicate_rejects_and_clears_pii(db):
    await _insert()
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_group(couch, BOOKING_ID) is True
    row = await _row()
    assert row["state"] == "rejected"
    assert row["reject_reason"] == "duplicate"
    _assert_pii_cleared(row)
    couch.bulk_docs.assert_not_awaited()


async def test_one_duplicate_rejects_whole_group_without_writing(db, caplog):
    caplog.set_level(logging.INFO)
    await _insert_group(3)
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_group(couch, BOOKING_ID) is True

    couch.bulk_docs.assert_not_awaited()
    for index in range(3):
        row = await _row(_row_id(index))
        assert row["state"] == "rejected"
        assert row["reject_reason"] == "duplicate"
        _assert_pii_cleared(row)
    _assert_no_pii_logged(caplog.text)


async def test_duplicate_after_api_cancel_keeps_cancelled(db):
    await _insert(evacuee_id="evacuee:E1", household_id="household:H1")
    couch = _couch()

    async def find_then_api_cancels(_database, selector, **_kwargs):
        if "$in" in selector.get("_id", {}):
            return []
        await _api_cancel_pending()
        return [{"_id": "evacuee:OTHER"}]

    couch.find = AsyncMock(side_effect=find_then_api_cancels)

    assert await _persist_group(couch, BOOKING_ID) is True
    row = await _row()
    assert row["state"] == "cancelled"
    assert row["reject_reason"] is None


async def test_retry_after_partial_write_is_not_rejected_by_new_duplicate(db):
    """FR-21: once part of the group is in CouchDB, finish it — don't orphan the rest."""
    await _insert_group(3)
    # An earlier attempt wrote person 0 (row `written`, PII cleared) and then crashed;
    # persons 1 and 2 have reserved ids but are still pending.
    await _api_update(
        {},
        {
            "state": "written",
            "evacuee_id": "evacuee:E0",
            "household_id": "household:H0",
            "cid": None,
            "first_name": None,
            "last_name": None,
            "phone": None,
        },
        _row_id(0),
    )
    for index in (1, 2):
        await _api_update(
            {},
            {"evacuee_id": f"evacuee:E{index}", "household_id": f"household:H{index}"},
            _row_id(index),
        )
    # Person 1 now also has a duplicate elsewhere in the shelter.
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_group(couch, BOOKING_ID) is True

    _, docs = couch.bulk_docs.await_args.args
    assert [d["_id"] for d in docs] == [
        "household:H1",
        "evacuee:E1",
        "household:H2",
        "evacuee:E2",
    ]
    assert {d["booking_ref"] for d in docs if d["type"] == "evacuee"} == {BOOKING_ID}
    for index in range(3):
        row = await _row(_row_id(index))
        assert row["state"] == "written"
        _assert_pii_cleared(row)


async def test_retry_after_crash_before_row_transition_is_not_rejected(db):
    """Docs reached CouchDB but no row was marked `written` yet — still not a reject."""
    await _insert_group(2)
    for index in (0, 1):
        await _api_update(
            {},
            {"evacuee_id": f"evacuee:E{index}", "household_id": f"household:H{index}"},
            _row_id(index),
        )
    couch = _couch(find=[{"_id": "evacuee:OTHER"}], written=[{"_id": "household:H0"}])

    assert await _persist_group(couch, BOOKING_ID) is True

    couch.bulk_docs.assert_awaited_once()
    for index in range(2):
        assert (await _row(_row_id(index)))["state"] == "written"


async def test_reached_couch_probe_failure_retries_instead_of_rejecting(db):
    await _insert_group(2)
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    async def find(_database, selector, **_kwargs):
        if "$in" in selector.get("_id", {}):
            raise RuntimeError("boom")
        return [{"_id": "evacuee:OTHER"}]

    couch.find = AsyncMock(side_effect=find)

    assert await _persist_group(couch, BOOKING_ID) is False
    couch.bulk_docs.assert_not_awaited()
    for index in range(2):
        assert (await _row(_row_id(index)))["state"] == "pending"


# ---------------------------------------------------------------- bulk results


async def test_bulk_conflict_counts_as_written(db):
    await _insert(evacuee_id="evacuee:E1", household_id="household:H1")
    couch = _couch(
        bulk=[
            {
                "id": "household:H1",
                "error": "conflict",
                "reason": "Document update conflict.",
            },
            {"ok": True, "id": "evacuee:E1", "rev": "1-b"},
        ]
    )

    assert await _persist_group(couch, BOOKING_ID) is True
    row = await _row()
    assert row["state"] == "written"
    _assert_pii_cleared(row)


async def test_bulk_other_error_keeps_pending(db, caplog):
    await _insert(evacuee_id="evacuee:E1", household_id="household:H1")
    couch = _couch(
        bulk=[
            {"ok": True, "id": "household:H1", "rev": "1-a"},
            {"id": "evacuee:E1", "error": "forbidden", "reason": "nope"},
        ]
    )

    assert await _persist_group(couch, BOOKING_ID) is False
    row = await _row()
    assert row["state"] == "pending"
    assert row["cid"] == CID
    # PII never reaches the logs.
    _assert_no_pii_logged(caplog.text)
    assert "evacuee:E1=forbidden" in caplog.text


async def test_partial_bulk_error_keeps_only_that_row_pending(db, caplog):
    await _insert_group(3)
    couch = _couch()

    async def bulk_fails_for_person_one(_database, docs):
        bad = {
            d["household_id"]
            for d in docs
            if d["type"] == "evacuee" and d["person_id"]["number"] == _cid(1)
        }
        return [
            {"id": d["_id"], "error": "forbidden", "reason": "nope"}
            if d["_id"] in bad or d.get("household_id") in bad
            else {"ok": True, "id": d["_id"], "rev": "1-x"}
            for d in docs
        ]

    couch.bulk_docs = AsyncMock(side_effect=bulk_fails_for_person_one)

    assert await _persist_group(couch, BOOKING_ID) is False

    for index in (0, 2):
        row = await _row(_row_id(index))
        assert row["state"] == "written"
        _assert_pii_cleared(row)
    stuck = await _row(_row_id(1))
    assert stuck["state"] == "pending"
    assert stuck["cid"] == _cid(1)
    assert stuck["evacuee_id"].startswith("evacuee:")
    _assert_no_pii_logged(caplog.text)


async def test_bulk_result_missing_for_a_row_keeps_it_pending(db):
    await _insert_group(2)
    couch = _couch()

    async def bulk_drops_last_doc(_database, docs):
        return _bulk_ok(_database, docs[:-1])

    couch.bulk_docs = AsyncMock(side_effect=bulk_drops_last_doc)

    assert await _persist_group(couch, BOOKING_ID) is False
    assert (await _row(_row_id(0)))["state"] == "written"
    assert (await _row(_row_id(1)))["state"] == "pending"


async def test_bulk_exception_keeps_pending(db):
    await _insert()
    couch = _couch()
    couch.bulk_docs = AsyncMock(side_effect=RuntimeError("boom"))

    assert await _persist_group(couch, BOOKING_ID) is False
    row = await _row()
    assert row["state"] == "pending"
    assert row["cid"] == CID


# ---------------------------------------------------------------- sweeper (FR-33)


async def _insert_stale_group(booking_id: str, size: int, *, prefix: str) -> None:
    for index in range(size):
        await _insert(
            id=f"{prefix}-{index}",
            booking_id=booking_id,
            person_seq=index,
            group_size=size,
            cid=_cid(index),
            cid_hash=f"{prefix}-h{index}",
        )


async def test_sweeper_deletes_stale_staged_rows_and_pending_siblings(db, caplog):
    caplog.set_level(logging.INFO)
    # API crashed mid-flip: row 0 committed (PII at rest), rows 1-2 still staged.
    await _insert_stale_group("BK-STALE", 3, prefix="S")
    await _api_update({}, {"committed": False}, "S-1")
    await _api_update({}, {"committed": False}, "S-2")

    assert await sweep_stale_staged() == 3

    assert await ExternalBooking.get_pymongo_collection().count_documents({}) == 0
    assert "BK-STALE" in caplog.text
    _assert_no_pii_logged(caplog.text)


async def test_sweeper_keeps_fresh_staged_rows_and_other_groups(db):
    now = datetime.now(UTC)
    # Fresh staged group — the API may still be committing it.
    await _insert_stale_group("BK-FRESH", 2, prefix="F")
    for index in range(2):
        await _api_update({}, {"committed": False, "created_at": now}, f"F-{index}")
    # Old but fully committed groups: pending (worker will take it) and a legacy row
    # without any `committed` field.
    await _insert_stale_group("BK-OK", 2, prefix="O")
    await _insert(id="BK-LEGACY", booking_id="BK-LEGACY", cid_hash="legacy")
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": "BK-LEGACY"}, {"$unset": {"committed": ""}}
    )

    assert await sweep_stale_staged() == 0

    assert await ExternalBooking.get_pymongo_collection().count_documents({}) == 5


async def test_sweeper_never_touches_terminal_rows_of_a_stale_group(db):
    await _insert_stale_group("BK-MIX", 5, prefix="M")
    states = {"M-1": "written", "M-2": "cancelled", "M-3": "rejected"}
    for row_id, state in states.items():
        await _api_update(
            {}, {"state": state, "evacuee_id": f"evacuee:{row_id}"}, row_id
        )
    await _api_update({}, {"committed": False}, "M-4")

    assert await sweep_stale_staged() == 2  # M-0 (pending) and M-4 (staged)

    remaining = {
        row["_id"]: row["state"]
        async for row in ExternalBooking.get_pymongo_collection().find({})
    }
    assert remaining == states
    assert (await _row("M-1"))["evacuee_id"] == "evacuee:M-1"


async def test_sweeper_does_not_touch_committed_groups_even_if_old(db):
    await _insert_stale_group("BK-A", 2, prefix="A")
    await _insert_stale_group("BK-B", 2, prefix="B")
    await _api_update({}, {"committed": False}, "B-1")

    assert await sweep_stale_staged() == 2

    remaining = [
        r["_id"] async for r in ExternalBooking.get_pymongo_collection().find({})
    ]
    assert sorted(remaining) == ["A-0", "A-1"]


async def test_sweeper_cutoff_is_sixty_seconds(db):
    now = datetime.now(UTC)
    await _insert(
        id="young", booking_id="BK-Y", cid_hash="y", committed=False,
        created_at=now - timedelta(seconds=inbound.STAGED_TTL_SECONDS - 20),
    )  # fmt: skip
    await _insert(
        id="old", booking_id="BK-O", cid_hash="o", committed=False,
        created_at=now - timedelta(seconds=inbound.STAGED_TTL_SECONDS + 20),
    )  # fmt: skip

    assert await sweep_stale_staged() == 1
    assert [
        r["_id"] async for r in ExternalBooking.get_pymongo_collection().find({})
    ] == ["young"]


async def test_sweeper_stale_filter_is_pending_only_and_uses_the_state_index(db):
    """R2: staged rows are always pending; a non-pending row is never swept."""
    await _insert(
        id="odd", booking_id="BK-ODD", cid_hash="odd", committed=False, state="written"
    )

    assert await sweep_stale_staged() == 0
    assert await ExternalBooking.get_pymongo_collection().count_documents({}) == 1

    stale = {
        "committed": False,
        "state": "pending",
        "created_at": {"$lt": datetime.now(UTC)},
    }
    plan = await ExternalBooking.get_pymongo_collection().find(stale).explain()
    assert "IXSCAN" in str(plan["queryPlanner"]["winningPlan"])
    assert "state_1_updated_at_1" in str(plan["queryPlanner"]["winningPlan"])


async def test_sweeper_spares_siblings_when_the_staged_row_was_committed_meanwhile(
    db, monkeypatch
):
    """R3: phase 2 only runs if phase 1 really deleted a stale staged row."""
    await _insert_stale_group("BK-RACE", 3, prefix="R")
    await _api_update({}, {"committed": False}, "R-2")
    collection = ExternalBooking.get_pymongo_collection()
    real_distinct = type(collection).distinct

    async def distinct_then_api_commits(self, *args, **kwargs):
        found = await real_distinct(self, *args, **kwargs)
        await self.update_many({"booking_id": "BK-RACE"}, {"$set": {"committed": True}})
        return found

    monkeypatch.setattr(type(collection), "distinct", distinct_then_api_commits)

    assert await sweep_stale_staged() == 0
    assert await collection.count_documents({"booking_id": "BK-RACE"}) == 3


# ---------------------------------------------------------------- loop


async def test_loop_sweeps_then_writes_groups_and_cancels(db, monkeypatch):
    monkeypatch.setattr(inbound, "POLL_INTERVAL_SECONDS", 0)
    await _insert_stale_group("BK-STALE", 2, prefix="S")
    await _api_update({}, {"committed": False}, "S-1")
    await _insert_group(2)
    await _insert(
        id="BP-cancel",
        booking_id="BK-CANCEL",
        cid_hash="hc",
        state="written",
        cancel_requested=True,
        cid=None,
        first_name=None,
        last_name=None,
        phone=None,
        evacuee_id="evacuee:E1",
        household_id="household:H1",
    )
    stop = asyncio.Event()
    couch = _couch(doc=_evacuee("cancelled"))

    async def get_doc_then_stop(*_args):
        stop.set()
        return _evacuee("cancelled")

    couch.get_doc = AsyncMock(side_effect=get_doc_then_stop)

    await inbound.run_external_booking_inbound_loop(couch, stop_event=stop)

    collection = ExternalBooking.get_pymongo_collection()
    assert await collection.count_documents({"booking_id": "BK-STALE"}) == 0
    # The whole group went out in a single bulk write.
    couch.bulk_docs.assert_awaited_once()
    assert len(couch.bulk_docs.await_args.args[1]) == 4
    assert (await _row(_row_id(0)))["state"] == "written"
    assert (await _row(_row_id(1)))["state"] == "written"
    assert (await _row("BP-cancel"))["state"] == "cancelled"


async def test_loop_survives_sweeper_failure(db, monkeypatch):
    monkeypatch.setattr(inbound, "POLL_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(
        inbound, "sweep_stale_staged", AsyncMock(side_effect=RuntimeError("boom"))
    )
    await _insert()
    stop = asyncio.Event()
    couch = _couch()

    async def bulk_then_stop(_database, docs):
        stop.set()
        return _bulk_ok(_database, docs)

    couch.bulk_docs = AsyncMock(side_effect=bulk_then_stop)

    await inbound.run_external_booking_inbound_loop(couch, stop_event=stop)

    assert (await _row())["state"] == "written"


# ---------------------------------------------------------------- cancel


def _evacuee(status: str) -> dict:
    return {
        "_id": "evacuee:E1",
        "_rev": "1-a",
        "type": "evacuee",
        "shelter_code": "SH001",
        "household_id": "household:H1",
        "current_stay": {
            "status": status,
            "zone": None,
            "since": "2026-10-06T00:00:00Z",
        },
        "updated_at": "2026-10-06T00:00:00Z",
    }


async def _insert_written() -> ExternalBooking:
    return await _insert(
        state="written",
        cancel_requested=True,
        cid=None,
        first_name=None,
        last_name=None,
        phone=None,
        evacuee_id="evacuee:E1",
        household_id="household:H1",
    )


async def test_cancel_pre_registered_evacuee(db):
    booking = await _insert_written()
    household = {
        "_id": "household:H1",
        "_rev": "1-h",
        "type": "household",
        "shelter_code": "SH001",
        "status": "pre_registered",
    }
    couch = _couch()
    couch.get_doc = AsyncMock(side_effect=[_evacuee("pre_registered"), household])
    couch.find = AsyncMock(return_value=[{"_id": "evacuee:E1", "current_stay": {}}])

    assert await _process_cancel(couch, booking) is True

    puts = [call.args[1] for call in couch.put_doc.await_args_list]
    evacuee_put = puts[0]
    assert evacuee_put["_id"] == "evacuee:E1"
    assert evacuee_put["_rev"] == "1-a"
    assert evacuee_put["current_stay"]["status"] == "cancelled"
    assert evacuee_put["current_stay"]["zone"] is None
    audits = [p for p in puts if p.get("type") == "audit"]
    assert {a["target_type"] for a in audits} == {"evacuee", "household"}
    assert all(a["created_by"] == "partner:M2" for a in audits)
    household_put = next(p for p in puts if p["_id"] == "household:H1")
    assert household_put["status"] == "cancelled"

    row = await _row()
    assert row["state"] == "cancelled"
    assert row["cancel_requested"] is False


async def test_cancel_keeps_household_when_other_member_pre_registered(db):
    booking = await _insert_written()
    household = {
        "_id": "household:H1",
        "status": "pre_registered",
        "shelter_code": "SH001",
    }
    couch = _couch()
    couch.get_doc = AsyncMock(side_effect=[_evacuee("pre_registered"), household])
    couch.find = AsyncMock(
        return_value=[
            {"_id": "evacuee:E1", "current_stay": {"status": "pre_registered"}},
            {"_id": "evacuee:E2", "current_stay": {"status": "pre_registered"}},
        ]
    )

    assert await _process_cancel(couch, booking) is True
    ids = [call.args[1]["_id"] for call in couch.put_doc.await_args_list]
    assert "household:H1" not in ids
    assert (await _row())["state"] == "cancelled"


async def test_cancel_active_evacuee_not_cancellable(db):
    booking = await _insert_written()
    couch = _couch(doc=_evacuee("active"))

    assert await _process_cancel(couch, booking) is True
    couch.put_doc.assert_not_awaited()
    row = await _row()
    assert row["state"] == "written"
    assert row["cancel_requested"] is False
    assert row["reject_reason"] == "not_cancellable"


async def test_cancel_evacuee_put_failure_retries(db):
    booking = await _insert_written()
    couch = _couch(doc=_evacuee("pre_registered"))
    couch.put_doc = AsyncMock(side_effect=RuntimeError("boom"))

    assert await _process_cancel(couch, booking) is False
    row = await _row()
    assert row["state"] == "written"
    assert row["cancel_requested"] is True


async def test_cancel_already_cancelled_stay_finishes_booking(db):
    booking = await _insert_written()
    couch = _couch(doc=_evacuee("cancelled"))

    assert await _process_cancel(couch, booking) is True
    couch.put_doc.assert_not_awaited()
    row = await _row()
    assert row["state"] == "cancelled"
    assert row["cancel_requested"] is False


async def test_poll_skips_rows_still_being_staged(db):
    """FR-32 — neither the pending nor the cancel branch may pick up `committed=False`."""
    await _insert(id="BP-staged-pending", booking_id="BK-S1", committed=False)
    await _insert(
        id="BP-staged-cancel",
        booking_id="BK-S1",
        cid_hash="h1",
        committed=False,
        state="written",
        cancel_requested=True,
    )
    await _insert(id="BP-pending", booking_id="BK-S2", cid_hash="h2")
    await _insert(
        id="BP-cancel",
        booking_id="BK-S3",
        cid_hash="h3",
        state="written",
        cancel_requested=True,
    )
    await _insert(id="BP-idle", booking_id="BK-S4", cid_hash="h4", state="written")

    assert sorted(booking.id for booking in await _find_due()) == [
        "BP-cancel",
        "BP-pending",
    ]


async def test_poll_includes_rows_without_committed_key(db):
    """Rows written before CR-169 have no `committed` field and are committed."""
    await _insert()
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": BOOKING_ID}, {"$unset": {"committed": ""}}
    )
    assert [booking.id for booking in await _find_due()] == [BOOKING_ID]


# ---------------------------------------------------------------- review round 1


def _stored_couch(initial=()):
    """A `_couch` whose bulk/get/put share one in-memory doc store (docs as written)."""
    couch = _couch()
    store: dict[str, dict] = {doc["_id"]: dict(doc) for doc in initial}

    async def bulk(database, docs):
        for doc in docs:
            store.setdefault(doc["_id"], dict(doc))
        return _bulk_ok(database, docs)

    async def get_doc(_database, doc_id):
        doc = store.get(doc_id)
        return dict(doc) if doc else None

    async def put_doc(_database, doc):
        store[doc["_id"]] = dict(doc)
        return {"ok": True}

    async def find(_database, selector, **_kwargs):
        if "type" in selector and "household_id" in selector:  # household members
            return [
                dict(d)
                for d in store.values()
                if d.get("type") == "evacuee"
                and d.get("household_id") == selector["household_id"]
            ]
        return []

    couch.bulk_docs = AsyncMock(side_effect=bulk)
    couch.get_doc = AsyncMock(side_effect=get_doc)
    couch.put_doc = AsyncMock(side_effect=put_doc)
    couch.find = AsyncMock(side_effect=find)
    return couch, store


def _stay_docs(
    index: int, *, status: str = "pre_registered", household: str | None = None
):
    """Couch evacuee + household for person `index`, as the worker writes them."""
    household_id = household or f"household:H{index}"
    return [
        {
            "_id": f"evacuee:E{index}",
            "type": "evacuee",
            "shelter_code": "SH001",
            "household_id": household_id,
            "current_stay": {"status": status, "zone": None, "since": "2026-10-06"},
        },
        {
            "_id": household_id,
            "type": "household",
            "shelter_code": "SH001",
            "status": "pre_registered",
        },
    ]


async def _reserve(index: int) -> None:
    await _api_update(
        {},
        {"evacuee_id": f"evacuee:E{index}", "household_id": f"household:H{index}"},
        _row_id(index),
    )


async def _api_cancel_all_but(*keep: int, size: int) -> None:
    for index in range(size):
        if index not in keep:
            await _api_cancel_pending(_row_id(index))


def _stop_after_polls(monkeypatch, polls: int) -> asyncio.Event:
    """Run the loop for `polls` full polls (the sweeper hook stops it on the next)."""
    monkeypatch.setattr(inbound, "POLL_INTERVAL_SECONDS", 0)
    stop = asyncio.Event()
    calls = [0]

    async def sweep() -> int:
        calls[0] += 1
        if calls[0] > polls:
            stop.set()
        return 0

    monkeypatch.setattr(inbound, "sweep_stale_staged", sweep)
    return stop


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(inbound, "_clock", lambda: now[0])
    return now


# R1 ------------------------------------------------------------------


async def test_crash_mid_reject_is_finished_on_the_next_pass_without_writing(
    db, monkeypatch
):
    await _insert_group(3)
    real_reject = inbound._reject_pending

    async def crash_after_first_row(_booking_id):
        await _api_update(
            {"state": "pending"},
            {"state": "rejected", "reject_reason": "duplicate", **dict.fromkeys(PII)},
            _row_id(0),
        )
        raise RuntimeError("crash")

    monkeypatch.setattr(inbound, "_reject_pending", crash_after_first_row)
    with pytest.raises(RuntimeError):
        await _persist_group(_couch(find=[{"_id": "evacuee:OTHER"}]), BOOKING_ID)
    monkeypatch.setattr(inbound, "_reject_pending", real_reject)
    assert (await _row(_row_id(0)))["state"] == "rejected"
    assert (await _row(_row_id(1)))["state"] == "pending"

    # Person 0's CID is cleared, so a fresh duplicate check would find nothing — the
    # rejected row itself must drive the rest of the group to `rejected`.
    couch = _couch()
    assert await _persist_group(couch, BOOKING_ID) is True

    couch.database_exists.assert_not_awaited()
    couch.find.assert_not_awaited()
    couch.bulk_docs.assert_not_awaited()
    for index in range(3):
        row = await _row(_row_id(index))
        assert row["state"] == "rejected"
        assert row["reject_reason"] == "duplicate"
        _assert_pii_cleared(row)


async def test_reject_is_one_guarded_update_that_spares_cancelled_rows(db):
    await _insert_group(3)
    await _api_cancel_pending(_row_id(1))
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_group(couch, BOOKING_ID) is True

    assert (await _row(_row_id(0)))["state"] == "rejected"
    cancelled = await _row(_row_id(1))
    assert cancelled["state"] == "cancelled"
    assert cancelled["reject_reason"] is None
    assert (await _row(_row_id(2)))["state"] == "rejected"


# R4 ------------------------------------------------------------------


async def _rebook(cid_hash: str) -> None:
    """The partner books the same CID again once the first booking is cancelled."""
    await _insert(id="BP-rebook", booking_id="BK-REBOOK", cid_hash=cid_hash)


async def test_cancel_during_write_with_rebooked_cid_cancels_stay_directly(db, caplog):
    caplog.set_level(logging.INFO)
    await _insert()
    couch, store = _stored_couch()
    real_bulk = couch.bulk_docs.side_effect

    async def bulk_then_api_cancels_and_rebooks(database, docs):
        result = await real_bulk(database, docs)
        await _api_cancel_pending()
        await _rebook("hash")
        return result

    couch.bulk_docs = AsyncMock(side_effect=bulk_then_api_cancels_and_rebooks)

    assert await _persist_group(couch, BOOKING_ID) is True

    row = await _row()
    assert row["state"] == "cancelled"  # unique index refused `written`
    assert row["cancel_requested"] is False
    evacuee = store[row["evacuee_id"]]
    assert evacuee["current_stay"]["status"] == "cancelled"
    assert store[row["household_id"]]["status"] == "cancelled"
    audits = [d for d in store.values() if d.get("type") == "audit"]
    assert {a["target_type"] for a in audits} == {"evacuee", "household"}
    # The re-booked row is untouched.
    assert (await _row("BP-rebook"))["state"] == "pending"
    _assert_no_pii_logged(caplog.text)


# R5 + probe selector --------------------------------------------------


async def test_stranded_cancelled_row_with_live_stay_is_routed_to_cancel(db):
    """Crash after the bulk write, then the API cancelled person 0 while rows 1-2 wait."""
    await _insert_group(3)
    for index in range(3):
        await _reserve(index)
    await _api_cancel_all_but(1, 2, size=3)
    couch, store = _stored_couch(_stay_docs(0))

    assert await _persist_group(couch, BOOKING_ID) is True

    row = await _row(_row_id(0))
    assert row["state"] == "written"
    assert row["cancel_requested"] is True
    _assert_pii_cleared(row)
    for index in (1, 2):
        assert (await _row(_row_id(index)))["state"] == "written"
    # And the next poll's cancel pass finishes the stay.
    booking = next(b for b in await _find_due() if b.id == _row_id(0))
    assert await _process_cancel(couch, booking) is True
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert store["household:H0"]["status"] == "cancelled"
    assert (await _row(_row_id(0)))["state"] == "cancelled"


async def test_cancelled_rows_without_a_live_stay_are_left_alone(db):
    await _insert_group(4)
    for index in range(3):
        await _reserve(index)
    # 0: stay already gone/never written; 1: stay already active; 3: never reserved.
    await _api_cancel_all_but(2, size=3)
    await _api_cancel_pending(_row_id(3))
    couch, store = _stored_couch(_stay_docs(1, status="active"))

    assert await _persist_group(couch, BOOKING_ID) is True

    for index in (0, 1, 3):
        row = await _row(_row_id(index))
        assert row["state"] == "cancelled", index
        assert row["cancel_requested"] is False
    asked = [call.args[1] for call in couch.get_doc.await_args_list]
    assert "evacuee:E3" not in asked and asked.count("evacuee:E1") == 1
    assert store["evacuee:E1"]["current_stay"]["status"] == "active"


async def test_stranded_row_with_rebooked_cid_gets_its_stay_cancelled_directly(db):
    await _insert_group(2)
    for index in range(2):
        await _reserve(index)
    await _api_cancel_all_but(1, size=2)
    await _rebook("h0")
    couch, store = _stored_couch(_stay_docs(0))

    assert await _persist_group(couch, BOOKING_ID) is True

    assert (await _row(_row_id(0)))["state"] == "cancelled"
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert store["household:H0"]["status"] == "cancelled"


def _probe_selectors(couch) -> list[dict]:
    selectors = [call.args[1] for call in couch.find.await_args_list]
    return [sel for sel in selectors if "$in" in sel.get("_id", {})]


async def _probe_group():
    """0, 1 pending with ids; 2 cancelled with ids; 3 cancelled before reserving."""
    await _insert_group(4)
    for index in range(3):
        await _reserve(index)
    await _api_cancel_pending(_row_id(2))
    await _api_cancel_pending(_row_id(3))


async def test_probe_asks_for_exactly_the_reserved_ids_of_pending_and_cancelled_rows(
    db,
):
    await _probe_group()
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_group(couch, BOOKING_ID) is True

    (probe,) = _probe_selectors(couch)
    assert probe["_id"] == {
        "$in": [
            "household:H0",
            "evacuee:E0",
            "household:H1",
            "evacuee:E1",
            "household:H2",
            "evacuee:E2",
        ]
    }
    # Nothing of the group is in Couch → still a clean duplicate reject, cancelled row kept.
    couch.bulk_docs.assert_not_awaited()
    assert (await _row(_row_id(0)))["state"] == "rejected"
    assert (await _row(_row_id(2)))["state"] == "cancelled"


async def test_cancelled_rows_docs_in_couch_count_as_group_reached_couch(db):
    await _probe_group()
    couch = _couch(find=[{"_id": "evacuee:OTHER"}], written=[{"_id": "household:H2"}])

    assert await _persist_group(couch, BOOKING_ID) is True

    couch.bulk_docs.assert_awaited_once()
    assert len(couch.bulk_docs.await_args.args[1]) == 4  # pending rows 0 and 1 only
    assert (await _row(_row_id(0)))["state"] == "written"
    assert (await _row(_row_id(1)))["state"] == "written"


async def test_written_row_is_proof_without_a_probe(db):
    await _insert_group(2)
    await _api_update({}, {"state": "written", **dict.fromkeys(PII)}, _row_id(0))
    await _reserve(0)
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_group(couch, BOOKING_ID) is True

    assert _probe_selectors(couch) == []
    couch.bulk_docs.assert_awaited_once()


# FR-41 group cancel ---------------------------------------------------


async def _insert_written_group(size: int, *, prefix: str = "BP", **overrides) -> None:
    for index in range(size):
        await _insert(
            id=f"{prefix}-{index}",
            person_seq=index,
            group_size=size,
            cid_hash=f"{prefix}-h{index}",
            state="written",
            cancel_requested=True,
            evacuee_id=f"evacuee:E{index}",
            household_id=f"household:H{index}",
            **dict.fromkeys(PII),
            **overrides,
        )


@pytest.mark.parametrize("size", [2, 3])
async def test_group_cancel_cancels_every_person_and_household(db, monkeypatch, size):
    await _insert_written_group(size)
    docs = [doc for index in range(size) for doc in _stay_docs(index)]
    couch, store = _stored_couch(docs)

    await inbound.run_external_booking_inbound_loop(
        couch, stop_event=_stop_after_polls(monkeypatch, 1)
    )

    for index in range(size):
        assert store[f"evacuee:E{index}"]["current_stay"]["status"] == "cancelled"
        assert store[f"household:H{index}"]["status"] == "cancelled"
        row = await _row(_row_id(index))
        assert row["state"] == "cancelled"
        assert row["cancel_requested"] is False
    audits = [d for d in store.values() if d.get("type") == "audit"]
    assert len(audits) == 2 * size  # one per evacuee + one per household


async def test_group_cancel_keeps_a_merged_household_until_its_last_member(
    db, monkeypatch
):
    """Staff merged persons 0 and 1 into one household: it closes with the last member."""
    await _insert_written_group(3)
    docs = [
        *_stay_docs(0),
        _stay_docs(1, household="household:H0")[0],
        *_stay_docs(2),
    ]
    couch, store = _stored_couch(docs)
    # Person 1 is the one still pre_registered in H0 when person 0 is cancelled first.

    await inbound.run_external_booking_inbound_loop(
        couch, stop_event=_stop_after_polls(monkeypatch, 1)
    )

    assert {store[f"evacuee:E{i}"]["current_stay"]["status"] for i in range(3)} == {
        "cancelled"
    }
    assert store["household:H0"]["status"] == "cancelled"
    assert store["household:H2"]["status"] == "cancelled"
    household_audits = [
        d
        for d in store.values()
        if d.get("type") == "audit" and d["target_type"] == "household"
    ]
    assert sorted(a["target_id"] for a in household_audits) == [
        "household:H0",
        "household:H2",
    ]


# R6 ------------------------------------------------------------------


async def test_one_failing_group_does_not_skip_the_rest_of_the_poll(
    db, monkeypatch, caplog
):
    await _insert_group(1, booking_id="BK-BAD")
    await _insert(
        id="BP-ok",
        booking_id="BK-OK",
        cid_hash="hok",
        cid="1103700099999",
        person_seq=0,
    )
    await _insert_written_group(1, prefix="W", booking_id="BK-CANCEL")
    couch, _store = _stored_couch(_stay_docs(0))
    real_persist = inbound._persist_group

    async def persist(couch_, booking_id, **kwargs):
        if booking_id == "BK-BAD":
            raise ValueError(f"bad row {CID} {PHONE} สมชาย ใจดี")
        return await real_persist(couch_, booking_id, **kwargs)

    monkeypatch.setattr(inbound, "_persist_group", persist)

    await inbound.run_external_booking_inbound_loop(
        couch, stop_event=_stop_after_polls(monkeypatch, 1)
    )

    assert (await _row("BP-ok"))["state"] == "written"
    assert (await _row("W-0"))["state"] == "cancelled"  # the cancel pass still ran
    assert "BK-BAD" in caplog.text and "ValueError" in caplog.text
    _assert_no_pii_logged(caplog.text)


async def test_one_failing_cancel_row_does_not_skip_the_others(db, monkeypatch):
    await _insert_written_group(2)
    couch, _store = _stored_couch([*_stay_docs(0), *_stay_docs(1)])
    real_cancel = inbound._process_cancel

    async def cancel(couch_, booking):
        if booking.id == _row_id(0):
            raise RuntimeError("boom")
        return await real_cancel(couch_, booking)

    monkeypatch.setattr(inbound, "_process_cancel", cancel)

    await inbound.run_external_booking_inbound_loop(
        couch, stop_event=_stop_after_polls(monkeypatch, 1)
    )

    assert (await _row(_row_id(0)))["state"] == "written"
    assert (await _row(_row_id(1)))["state"] == "cancelled"


# R8 ------------------------------------------------------------------


def test_failure_tracker_backs_off_exponentially_with_a_cap_and_resets(clock):
    tracker = FailureTracker()
    assert tracker.ready("group:X")

    delays = [tracker.failed("group:X")[1] for _ in range(12)]
    assert delays[0] == BACKOFF_BASE_SECONDS
    assert delays[1] == 2 * BACKOFF_BASE_SECONDS
    assert delays[-1] == BACKOFF_MAX_SECONDS
    assert max(delays) == BACKOFF_MAX_SECONDS

    assert not tracker.ready("group:X")
    clock[0] += BACKOFF_MAX_SECONDS - 1
    assert not tracker.ready("group:X")
    clock[0] += 1
    assert tracker.ready("group:X")
    assert tracker.ready("group:Y")  # keys are independent

    tracker.succeeded("group:X")
    assert tracker.failed("group:X") == (1, BACKOFF_BASE_SECONDS)


def test_failure_tracker_throttles_logs_and_prunes_dead_keys(clock):
    tracker = FailureTracker()
    assert tracker.should_log("k")
    assert not tracker.should_log("k")
    clock[0] += LOG_THROTTLE_SECONDS
    assert tracker.should_log("k")

    tracker.failed("group:gone")
    tracker.failed("group:live")
    tracker.prune({"group:live"})
    assert tracker.ready("group:gone")  # forgotten
    assert not tracker.ready("group:live")


async def test_bulk_failure_backs_the_group_off_and_logs_once(db, clock, caplog):
    await _insert_group(2)
    forbidden = [
        {"id": "x", "error": "forbidden", "reason": "nope"},
    ]
    couch = _couch(bulk=forbidden)
    tracker = FailureTracker()

    assert await _persist_group(couch, BOOKING_ID, health=tracker) is False
    assert not tracker.ready(f"group:{BOOKING_ID}")
    assert await _persist_group(couch, BOOKING_ID, health=tracker) is False
    assert await _persist_group(couch, BOOKING_ID, health=tracker) is False
    # Three attempts inside the throttle window → one ERROR burst (2 rows), not three.
    assert caplog.text.count("Bulk write row failures") == 2
    assert "attempt 1" in caplog.text and "attempt 3" not in caplog.text

    clock[0] += LOG_THROTTLE_SECONDS + 1
    assert await _persist_group(couch, BOOKING_ID, health=tracker) is False
    assert "attempt 4" in caplog.text
    _assert_no_pii_logged(caplog.text)


async def test_loop_does_not_retry_a_backed_off_group_every_poll(
    db, monkeypatch, clock
):
    await _insert()
    couch = _couch(bulk=[{"id": "x", "error": "forbidden", "reason": "nope"}])

    await inbound.run_external_booking_inbound_loop(
        couch, stop_event=_stop_after_polls(monkeypatch, 5)
    )

    couch.bulk_docs.assert_awaited_once()  # polls 2-5 fall inside the backoff window
    assert (await _row())["state"] == "pending"


async def test_incomplete_group_log_is_throttled(db, clock, caplog):
    caplog.set_level(logging.INFO)
    await _insert_group(2)
    await _api_update({}, {"committed": False}, _row_id(1))
    couch = _couch()
    tracker = FailureTracker()

    for _ in range(5):
        assert await _persist_group(couch, BOOKING_ID, health=tracker) is False
    assert caplog.text.count("incomplete") == 1

    clock[0] += LOG_THROTTLE_SECONDS
    await _persist_group(couch, BOOKING_ID, health=tracker)
    assert caplog.text.count("incomplete") == 2


# PII never reaches the logs -------------------------------------------

_LEAK = f"bad doc {CID} {PHONE} สมชาย ใจดี ชื่อ0 สกุล0 08000000"


def _leaking_couch(where: str):
    couch, _ = _stored_couch()
    boom = ValueError(_LEAK)
    if where == "bulk_docs":
        couch.bulk_docs = AsyncMock(side_effect=boom)
    elif where == "find":
        couch.find = AsyncMock(side_effect=boom)
    else:
        couch.get_doc = AsyncMock(side_effect=boom)
    return couch


@pytest.mark.parametrize("where", ["bulk_docs", "find"])
async def test_exceptions_carrying_pii_are_logged_by_type_only(db, caplog, where):
    await _insert_group(2)
    assert await _persist_group(_leaking_couch(where), BOOKING_ID) is False

    assert "ValueError" in caplog.text
    assert all(record.exc_info is None for record in caplog.records)
    _assert_no_pii_logged(caplog.text)
    assert "Traceback" not in caplog.text


async def test_cancel_exception_carrying_pii_is_logged_by_type_only(db, caplog):
    await _insert_written_group(1)
    booking = (await _find_due())[0]

    assert await _process_cancel(_leaking_couch("get_doc"), booking) is False

    assert "ValueError" in caplog.text
    _assert_no_pii_logged(caplog.text)


async def test_loop_level_exceptions_carrying_pii_are_logged_by_type_only(
    db, monkeypatch, caplog
):
    await _insert()
    monkeypatch.setattr(inbound, "_find_due", AsyncMock(side_effect=ValueError(_LEAK)))
    monkeypatch.setattr(inbound, "POLL_INTERVAL_SECONDS", 0)
    stop = asyncio.Event()

    async def sweep_fails_then_stops():
        stop.set()
        raise ValueError(_LEAK)

    monkeypatch.setattr(inbound, "sweep_stale_staged", sweep_fails_then_stops)

    await inbound.run_external_booking_inbound_loop(_couch(), stop_event=stop)

    assert "ValueError" in caplog.text
    _assert_no_pii_logged(caplog.text)
    assert "Traceback" not in caplog.text
