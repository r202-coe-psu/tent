"""Tests for the partner booking inbound loop (CR-154 C6, CR-169 C3/C4).

State tests run against the real test Mongo (``db`` fixture) because the point of the
worker's writes is that they are conditional on the row's current state — the API
mutates the same rows concurrently (EXT-009 cancel). A booking is a *group* of rows
sharing ``booking_id``; the worker writes it as one unit (FR-21, FR-34) and the
sweeper drops groups the API never finished committing (FR-33).
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from tent_model import ExternalBooking

import worker.inbound.external_bookings as inbound
from worker.couch.client import CouchClient
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
    revert_abandoned_cancel_flags,
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


def _fake_update_doc(couch):
    """`CouchClient.update_doc` on top of the mock's `get_doc` / `put_doc` (no conflicts;
    the real conflict handling is covered with `_FakeCouch` and in test_couch_client)."""

    async def update_doc(database, doc_id, mutate, **_kwargs):
        current = await couch.get_doc(database, doc_id)
        if current is None:
            return None
        changed = await mutate(current)
        if changed is None:
            return None
        await couch.put_doc(database, changed)
        return changed

    return update_doc


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
    couch.update_doc = AsyncMock(side_effect=_fake_update_doc(couch))
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
    assert doc["schema_v"] == 15
    assert doc["booking_ref"] == "BK-01TEST"
    assert "consent" not in doc
    assert doc["privacy"] == {"search_excluded": False}
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
    assert evacuee["schema_v"] == 15
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
    assert {d["schema_v"] for d in evacuees} == {15}
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


async def test_cancelled_during_write_cancels_the_stay_and_stays_cancelled(db):
    """Review R3/G4: the row the API cancelled mid-write is not re-opened as `written` +
    `cancel_requested`; its fresh stay is cancelled right away and the row stays cancelled."""
    await _insert()
    couch, store = _stored_couch()
    real_bulk = couch.bulk_docs.side_effect

    async def bulk_then_api_cancels(database, docs):
        result = await real_bulk(database, docs)
        await _api_cancel_pending()
        return result

    couch.bulk_docs = AsyncMock(side_effect=bulk_then_api_cancels)

    assert await _persist_group(couch, BOOKING_ID) is True

    row = await _row()
    assert row["state"] == "cancelled"
    assert row["cancel_requested"] is False
    assert row["cancel_reason"] == "partner cancel"
    assert row["evacuee_id"].startswith("evacuee:")
    _assert_pii_cleared(row)
    assert store[row["evacuee_id"]]["current_stay"]["status"] == "cancelled"
    assert store[row["household_id"]]["status"] == "cancelled"
    assert BOOKING_ID not in {b.id for b in await _find_due()}


async def test_cancelled_during_write_with_a_checked_in_evacuee_is_left_alone(db):
    await _insert()
    couch, store = _stored_couch()
    real_bulk = couch.bulk_docs.side_effect

    async def bulk_then_cancel_and_check_in(database, docs):
        result = await real_bulk(database, docs)
        await _api_cancel_pending()
        evacuee = next(d for d in store.values() if d["type"] == "evacuee")
        evacuee["current_stay"]["status"] = "active"
        return result

    couch.bulk_docs = AsyncMock(side_effect=bulk_then_cancel_and_check_in)

    assert await _persist_group(couch, BOOKING_ID) is True

    assert (await _row())["state"] == "cancelled"
    evacuee = next(d for d in store.values() if d["type"] == "evacuee")
    assert evacuee["current_stay"]["status"] == "active"


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


def _dup_couch(live: dict[str, int], *, in_couch=(), bulk=None):
    """A `_couch` whose duplicate query answers like Mango: hits are the live evacuees
    holding one of the asked CIDs, capped at `limit`. `live` = cid -> holder count."""
    couch = _couch(bulk=bulk)
    couch.dup_selectors = []

    async def find(_database, selector, *, fields=None, limit=25):
        if "$in" in selector.get("_id", {}):
            return [{"_id": i} for i in selector["_id"]["$in"] if i in set(in_couch)]
        couch.dup_selectors.append((selector, fields, limit))
        asked = selector["person_id.number"]["$in"]
        hits = [
            {"_id": f"evacuee:OTHER-{cid}-{n}", "person_id": {"number": cid}}
            for cid, count in live.items()
            if cid in asked
            for n in range(count)
        ]
        return hits[:limit]

    couch.find = AsyncMock(side_effect=find)
    return couch


async def _partly_written_group(size: int) -> None:
    """Person 0 was written by an earlier attempt that then crashed; the rest has
    reserved ids but is still pending."""
    await _insert_group(size)
    await _api_update(
        {},
        {
            "state": "written",
            "evacuee_id": "evacuee:E0",
            "household_id": "household:H0",
            **dict.fromkeys(PII),
        },
        _row_id(0),
    )
    for index in range(1, size):
        await _reserve(index)


async def test_retry_after_partial_write_rejects_only_the_duplicated_person(db, caplog):
    """FR-21 retry rule (CR-169 D1): part of the group is in CouchDB, person 1 is now a
    duplicate -> reject person 1 only; person 0 stays written and person 2 is written."""
    caplog.set_level(logging.INFO)
    await _partly_written_group(3)
    before = await _row(_row_id(0))
    couch = _dup_couch({_cid(1): 1})

    assert await _persist_group(couch, BOOKING_ID) is True

    (selector, fields, limit), *_ = couch.dup_selectors
    assert selector["person_id.number"] == {"$in": [_cid(1), _cid(2)]}  # pending only
    assert "person_id.number" in fields and limit == 2
    _, docs = couch.bulk_docs.await_args.args
    assert [d["_id"] for d in docs] == ["household:H2", "evacuee:E2"]
    rejected = await _row(_row_id(1))
    assert rejected["state"] == "rejected"
    assert rejected["reject_reason"] == "duplicate"
    _assert_pii_cleared(rejected)
    written = await _row(_row_id(2))
    assert written["state"] == "written"
    _assert_pii_cleared(written)
    assert await _row(_row_id(0)) == before  # already-written rows are untouched
    _assert_no_pii_logged(caplog.text)


async def test_retry_after_partial_write_with_every_pending_person_duplicated(db):
    await _partly_written_group(3)
    couch = _dup_couch({_cid(1): 1, _cid(2): 2})

    assert await _persist_group(couch, BOOKING_ID) is True

    couch.bulk_docs.assert_not_awaited()
    assert (await _row(_row_id(0)))["state"] == "written"
    for index in (1, 2):
        row = await _row(_row_id(index))
        assert (row["state"], row["reject_reason"]) == ("rejected", "duplicate")
        _assert_pii_cleared(row)


def _live_holders(store: dict[str, dict], cid: str) -> list[str]:
    return [
        doc["_id"]
        for doc in store.values()
        if doc.get("type") == "evacuee"
        and (doc.get("person_id") or {}).get("number") == cid
        and doc["current_stay"]["status"] in HOLD_STATUSES
    ]


def _evacuee_doc(index: int, cid: str, status: str = "pre_registered") -> dict:
    doc = _stay_docs(index, status=status)[0]
    doc["person_id"] = {"cardType": "national_id", "number": cid}
    return doc


def _fr50_couch(initial):
    """`_stored_couch` whose `find` also answers the duplicate / probe queries like Mango."""
    couch, store = _stored_couch(initial)
    members_find = couch.find.side_effect

    async def find(database, selector, **kwargs):
        if "$in" in selector.get("_id", {}):
            return [{"_id": i} for i in selector["_id"]["$in"] if i in store]
        if "person_id.number" in selector:
            asked = selector["person_id.number"]["$in"]
            own = selector["_id"]["$nin"]
            return [
                {"_id": d["_id"], "person_id": d["person_id"]}
                for d in store.values()
                if d.get("type") == "evacuee"
                and d["_id"] not in own
                and d.get("person_id", {}).get("number") in asked
                and d["current_stay"]["status"]
                in selector["current_stay.status"]["$in"]
            ][: kwargs.get("limit", 25)]
        return await members_find(database, selector, **kwargs)

    couch.find = AsyncMock(side_effect=find)
    return couch, store


async def test_in_couch_pending_row_with_a_duplicated_cid_is_rejected_and_its_stay_cancelled(
    db, caplog
):
    """CR-169 D4 (review R3/G2): crash after the bulk write, before any row transition —
    persons 0 and 1 are in CouchDB, still pending. Person 0's CID is now also held by
    someone else: reject person 0 and cancel the stay that is already in CouchDB (FR-50),
    write person 1 (its docs already exist, so the bulk write reports a conflict = written)."""
    caplog.set_level(logging.INFO)
    await _insert_group(2)
    for index in (0, 1):
        await _reserve(index)
    other = _evacuee_doc(9, _cid(0))
    couch, store = _fr50_couch(
        [
            *_stay_docs(0),
            *_stay_docs(1),
            other,
        ]
    )
    store["evacuee:E0"]["person_id"] = {"number": _cid(0)}
    store["evacuee:E1"]["person_id"] = {"number": _cid(1)}

    assert await _persist_group(couch, BOOKING_ID) is True

    rejected = await _row(_row_id(0))
    assert (rejected["state"], rejected["reject_reason"]) == ("rejected", "duplicate")
    _assert_pii_cleared(rejected)
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert store["household:H0"]["status"] == "cancelled"
    assert any(
        d.get("type") == "audit" and d["target_id"] == "evacuee:E0"
        for d in store.values()
    )
    written = await _row(_row_id(1))
    assert written["state"] == "written"
    _assert_pii_cleared(written)
    assert store["evacuee:E1"]["current_stay"]["status"] == "pre_registered"
    # FR-50 end state: the CID has exactly one live holder, and it is not ours.
    assert _live_holders(store, _cid(0)) == [other["_id"]]
    assert _live_holders(store, _cid(1)) == ["evacuee:E1"]
    _assert_no_pii_logged(caplog.text)

    # Idempotent: a further pass changes nothing.
    snapshot = {key: dict(doc) for key, doc in store.items()}
    assert await _persist_group(couch, BOOKING_ID) is True
    assert store == snapshot


async def test_in_couch_row_cancelled_by_the_api_while_duplicated_is_not_rejected(db):
    """The CAS on `pending` fails for a row the API cancelled first; it stays cancelled."""
    await _insert_group(2)
    for index in (0, 1):
        await _reserve(index)
    couch, store = _fr50_couch(
        [*_stay_docs(0), *_stay_docs(1), _evacuee_doc(9, _cid(0))]
    )
    store["evacuee:E0"]["person_id"] = {"number": _cid(0)}
    real_find = couch.find.side_effect

    async def find_then_api_cancels(database, selector, **kwargs):
        hits = await real_find(database, selector, **kwargs)
        if "person_id.number" in selector:
            await _api_cancel_pending(_row_id(0))
        return hits

    couch.find = AsyncMock(side_effect=find_then_api_cancels)

    assert await _persist_group(couch, BOOKING_ID) is True

    row = await _row(_row_id(0))
    assert (row["state"], row["reject_reason"]) == ("cancelled", None)
    # The row is terminal either way (cancelled by the API), so its stay must not be left
    # live next to the new holder of the CID (FR-50) — even though our CAS lost.
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert (await _row(_row_id(1)))["state"] == "written"
    assert store["evacuee:E1"]["current_stay"]["status"] == "pre_registered"


async def test_d4_rejected_row_in_couch_still_proves_the_group_reached_couch(db):
    """Review R4/H1: person 0 (in CouchDB) is rejected as a per-person duplicate, then the
    bulk write of person 1 fails. On the next pass person 1's CID is not duplicated, so it
    must be written — not rejected because the group "never reached CouchDB"."""
    await _insert_group(2)
    for index in (0, 1):
        await _reserve(index)
    couch, store = _fr50_couch(
        [*_stay_docs(0), *_stay_docs(1), _evacuee_doc(9, _cid(0))]
    )
    store["evacuee:E0"]["person_id"] = {"number": _cid(0)}
    del store["evacuee:E1"], store["household:H1"]  # person 1 never reached CouchDB
    real_bulk = couch.bulk_docs.side_effect

    async def failing_bulk(database, docs):
        return [{"id": doc["_id"], "error": "forbidden"} for doc in docs]

    couch.bulk_docs = AsyncMock(side_effect=failing_bulk)
    assert await _persist_group(couch, BOOKING_ID) is False
    assert (await _row(_row_id(0)))["state"] == "rejected"
    assert (await _row(_row_id(1)))["state"] == "pending"
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"

    couch.bulk_docs = AsyncMock(side_effect=real_bulk)
    assert await _persist_group(couch, BOOKING_ID) is True

    rejected = await _row(_row_id(0))
    assert (rejected["state"], rejected["reject_reason"]) == ("rejected", "duplicate")
    written = await _row(_row_id(1))
    assert (written["state"], written["reject_reason"]) == ("written", None)
    _assert_pii_cleared(written)
    assert store["evacuee:E1"]["current_stay"]["status"] == "pre_registered"
    assert _live_holders(store, _cid(0)) == [_evacuee_doc(9, _cid(0))["_id"]]


async def test_failed_stay_cancel_of_d4_rejected_row_is_retried_while_a_sibling_is_pending(
    db,
):
    """Review R5/I1: person 0 (in CouchDB) is rejected as a per-person duplicate but CouchDB
    is down, so neither the stay cancel nor the bulk write of person 1 lands. Person 1 is
    still ``pending``, so the group is processed again — and that pass must retry the stay
    cancel of the already ``rejected`` row 0, or the CID keeps two live holders (FR-50)."""
    await _insert_group(2)
    for index in (0, 1):
        await _reserve(index)
    couch, store = _fr50_couch(
        [*_stay_docs(0), *_stay_docs(1), _evacuee_doc(9, _cid(0))]
    )
    store["evacuee:E0"]["person_id"] = {"number": _cid(0)}
    real_update = couch.update_doc
    real_bulk = couch.bulk_docs.side_effect

    async def down(*_args, **_kwargs):
        raise ConnectionError("couch down")

    couch.update_doc = AsyncMock(side_effect=down)
    couch.bulk_docs = AsyncMock(side_effect=down)
    assert await _persist_group(couch, BOOKING_ID) is False
    assert (await _row(_row_id(0)))["state"] == "rejected"
    assert (await _row(_row_id(1)))["state"] == "pending"
    assert store["evacuee:E0"]["current_stay"]["status"] == "pre_registered"

    couch.update_doc = real_update
    couch.bulk_docs = AsyncMock(side_effect=real_bulk)
    assert await _persist_group(couch, BOOKING_ID) is True

    assert (await _row(_row_id(0)))["state"] == "rejected"
    assert (await _row(_row_id(1)))["state"] == "written"
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert _live_holders(store, _cid(0)) == ["evacuee:E9"]


async def test_checked_in_stay_of_d4_rejected_row_is_never_cancelled_or_retried(db):
    """CR-169 FR-21 H8: person 0 (in CouchDB) is a per-person duplicate, but staff already
    checked their stay in (``active``). The row is rejected, yet the stay is not
    ``pre_registered`` so no pass — first, nor the retry while person 1 is still pending
    (``_cancel_stranded_rows``) — writes the evacuee or an audit doc for it."""
    await _insert_group(2)
    for index in (0, 1):
        await _reserve(index)
    couch, store = _fr50_couch(
        [*_stay_docs(0), *_stay_docs(1), _evacuee_doc(9, _cid(0))]
    )
    store["evacuee:E0"]["person_id"] = {"number": _cid(0)}
    store["evacuee:E0"]["current_stay"]["status"] = "active"
    checked_in = dict(store["evacuee:E0"])
    household = dict(store["household:H0"])
    real_bulk = couch.bulk_docs.side_effect

    async def failing_bulk(database, docs):
        return [{"id": doc["_id"], "error": "forbidden"} for doc in docs]

    couch.bulk_docs = AsyncMock(side_effect=failing_bulk)
    assert await _persist_group(couch, BOOKING_ID) is False
    assert (await _row(_row_id(0)))["state"] == "rejected"
    assert (await _row(_row_id(1)))["state"] == "pending"

    couch.bulk_docs = AsyncMock(side_effect=real_bulk)
    assert await _persist_group(couch, BOOKING_ID) is True

    rejected = await _row(_row_id(0))
    assert (rejected["state"], rejected["reject_reason"]) == ("rejected", "duplicate")
    _assert_pii_cleared(rejected)
    written = await _row(_row_id(1))
    assert (written["state"], written["reject_reason"]) == ("written", None)
    assert store["evacuee:E0"] == checked_in
    assert store["evacuee:E0"]["current_stay"]["status"] == "active"
    assert store["household:H0"] == household
    assert not any(
        d.get("type") == "audit" and d["target_id"] == "evacuee:E0"
        for d in store.values()
    )
    assert store["evacuee:E1"]["current_stay"]["status"] == "pre_registered"


async def test_cancel_stranded_rows_never_touches_pending_or_written_rows(db):
    """Only terminal ``cancelled`` / ``rejected`` rows qualify (R5): a ``pending`` or
    ``written`` row with reserved ids keeps its ``pre_registered`` stay."""
    await _insert_group(3)
    for index in range(3):
        await _reserve(index)
    couch, store = _fr50_couch([*_stay_docs(0), *_stay_docs(1), *_stay_docs(2)])
    rows = (
        await ExternalBooking.find({"booking_id": BOOKING_ID})
        .sort("person_seq")
        .to_list()
    )
    rows[1].state = "written"
    rows[2].state = "rejected"
    snapshot = copy.deepcopy(store)

    await inbound._cancel_stranded_rows(couch, DB, rows)

    assert rows[0].state == "pending"
    assert store["evacuee:E0"] == snapshot["evacuee:E0"]
    assert store["evacuee:E1"] == snapshot["evacuee:E1"]
    assert store["evacuee:E2"]["current_stay"]["status"] == "cancelled"


async def test_failed_stay_cancel_of_a_rejected_in_couch_row_is_logged_by_id_only(
    db, caplog
):
    await _insert_group(2)
    for index in (0, 1):
        await _reserve(index)
    couch, store = _fr50_couch(
        [*_stay_docs(0), *_stay_docs(1), _evacuee_doc(9, _cid(0))]
    )
    store["evacuee:E0"]["person_id"] = {"number": _cid(0)}
    couch.update_doc = AsyncMock(side_effect=ValueError(_LEAK))

    assert await _persist_group(couch, BOOKING_ID) is True  # the pass itself goes on

    assert (await _row(_row_id(0)))["state"] == "rejected"
    assert (await _row(_row_id(1)))["state"] == "written"
    assert "Could not cancel evacuee" in caplog.text and "ValueError" in caplog.text
    _assert_no_pii_logged(caplog.text)


async def test_duplicate_rejects_the_whole_group_when_nothing_reached_couch(db):
    """Unchanged FR-21: no row written, nothing in Couch -> one duplicated CID rejects all."""
    await _insert_group(3)
    couch = _dup_couch({_cid(1): 1})

    assert await _persist_group(couch, BOOKING_ID) is True

    couch.bulk_docs.assert_not_awaited()
    for index in range(3):
        row = await _row(_row_id(index))
        assert (row["state"], row["reject_reason"]) == ("rejected", "duplicate")
        _assert_pii_cleared(row)


async def test_partial_reject_survives_a_failed_bulk_write_and_is_finished_later(db):
    """The rejection of person 1 is persisted before the bulk write. If that write then
    fails, the retry must not read the rejected row as 'group rejected' (R1) and reject
    person 2 as well."""
    await _partly_written_group(3)
    failing = _dup_couch({_cid(1): 1})
    failing.bulk_docs = AsyncMock(side_effect=RuntimeError("couch down"))
    assert await _persist_group(failing, BOOKING_ID) is False
    assert (await _row(_row_id(1)))["state"] == "rejected"
    assert (await _row(_row_id(2)))["state"] == "pending"

    couch = _dup_couch({})
    assert await _persist_group(couch, BOOKING_ID) is True

    _, docs = couch.bulk_docs.await_args.args
    assert [d["_id"] for d in docs] == ["household:H2", "evacuee:E2"]
    assert (await _row(_row_id(2)))["state"] == "written"
    assert (await _row(_row_id(1)))["state"] == "rejected"


async def test_duplicate_query_pages_so_one_busy_cid_cannot_hide_another(db):
    cids = [_cid(0), _cid(1), _cid(2)]
    couch = _dup_couch({_cid(1): 3, _cid(2): 1})

    hits = await inbound._find_duplicates(couch, DB, cids, ["evacuee:own"])

    assert {inbound._hit_cid(hit) for hit in hits} == {_cid(1), _cid(2)}
    limits = [limit for _, _, limit in couch.dup_selectors]
    assert limits[0] == 3 and all(limit <= 3 for limit in limits)


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


def _docs_by_id(*docs):
    by_id = {doc["_id"]: doc for doc in docs}

    async def get_doc(_database, doc_id):
        doc = by_id.get(doc_id)
        return dict(doc) if doc else None

    return get_doc


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
    couch.get_doc = AsyncMock(
        side_effect=_docs_by_id(_evacuee("pre_registered"), household)
    )
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
    couch.get_doc = AsyncMock(
        side_effect=_docs_by_id(_evacuee("pre_registered"), household)
    )
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


@pytest.mark.parametrize(
    "status",
    ["arriving", "active", "room_confirmed", "temporary_leave", "kiosk_registered"],
)
async def test_cancel_keeps_household_while_another_member_is_held(db, status):
    """EXT-009 cancel path (#613): a live member that is not pre_registered keeps the
    household; only the cancelled stay changes."""
    booking = await _insert_written()
    household = {
        "_id": "household:H1",
        "status": "pre_registered",
        "shelter_code": "SH001",
    }
    couch = _couch()
    couch.get_doc = AsyncMock(
        side_effect=_docs_by_id(_evacuee("pre_registered"), household)
    )
    couch.find = AsyncMock(
        return_value=[
            {"_id": "evacuee:E2", "current_stay": {"status": status}},
        ]
    )

    assert await _process_cancel(couch, booking) is True

    puts = [call.args[1] for call in couch.put_doc.await_args_list]
    assert [p["_id"] for p in puts if p.get("type") == "household"] == []
    assert "household:H1" not in [p["_id"] for p in puts]
    assert not any(p.get("target_type") == "household" for p in puts)
    assert next(p for p in puts if p["_id"] == "evacuee:E1")["current_stay"][
        "status"
    ] == ("cancelled")
    row = await _row()
    assert row["state"] == "cancelled"


async def test_cancel_audit_failure_is_best_effort_and_still_cancels(db):
    """The EXT-009 path keeps its best-effort audit: a failed audit write is logged and the
    booking still finishes as cancelled."""
    booking = await _insert_written()
    couch = _couch(doc=_evacuee("pre_registered"))
    write = AsyncMock(return_value={"ok": True})

    async def fail_audits(database, doc):
        if doc["_id"].startswith("audit:"):
            raise RuntimeError("boom")
        return await write(database, doc)

    couch.put_doc = AsyncMock(side_effect=fail_audits)

    assert await _process_cancel(couch, booking) is True
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

    # Only the "did any of it reach Couch?" probe is made; nothing is written.
    assert len(_probe_selectors(couch)) == 1
    assert couch.find.await_count == 1
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


async def test_stranded_cancelled_row_has_its_stay_cancelled_and_stays_cancelled(db):
    """Crash after the bulk write, then the API cancelled person 0 while rows 1-2 wait."""
    await _insert_group(3)
    for index in range(3):
        await _reserve(index)
    await _api_cancel_all_but(1, 2, size=3)
    couch, store = _stored_couch(_stay_docs(0))

    assert await _persist_group(couch, BOOKING_ID) is True

    row = await _row(_row_id(0))
    assert row["state"] == "cancelled"  # never re-opened as `written`
    assert row["cancel_requested"] is False
    assert row["reject_reason"] is None
    _assert_pii_cleared(row)
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert store["household:H0"]["status"] == "cancelled"
    audits = [d for d in store.values() if d.get("type") == "audit"]
    assert {a["target_id"] for a in audits} == {"evacuee:E0", "household:H0"}
    for index in (1, 2):
        assert (await _row(_row_id(index)))["state"] == "written"
    assert _row_id(0) not in {b.id for b in await _find_due()}


async def test_stranded_cancelled_row_is_not_reopened_if_staff_check_in_afterwards(
    db, monkeypatch
):
    """Review R2/F1: re-opening the row as `written` + `cancel_requested` left it stuck
    `written` / `not_cancellable` (still holding the CID) once staff had checked the
    evacuee in before the cancel poll. The stay is now cancelled in the same pass."""
    await _insert_group(2)
    for index in range(2):
        await _reserve(index)
    await _api_cancel_all_but(1, size=2)
    couch, store = _stored_couch(_stay_docs(0))

    assert await _persist_group(couch, BOOKING_ID) is True
    store["evacuee:E0"]["current_stay"]["status"] = (
        "active"  # staff check-in, a beat late
    )

    await inbound.run_external_booking_inbound_loop(
        couch, stop_event=_stop_after_polls(monkeypatch, 2)
    )

    row = await _row(_row_id(0))
    assert (row["state"], row["cancel_requested"], row["reject_reason"]) == (
        "cancelled",
        False,
        None,
    )


async def test_whole_group_cancelled_after_a_crash_is_reconciled_by_the_loop(
    db, monkeypatch
):
    """#613 (closes R5 / #595): the process died after the bulk write and the API then
    cancelled *every* pending row, so the group is never due again. The reconcile pass
    reads the reserved ids of the terminal rows directly and cancels those stays."""
    await _insert_group(2)
    for index in range(2):
        await _reserve(index)
    await _api_cancel_all_but(size=2)
    couch, store = _stored_couch([*_stay_docs(0), *_stay_docs(1)])

    assert await _find_due() == []
    await inbound.run_external_booking_inbound_loop(
        couch, stop_event=_stop_after_polls(monkeypatch, 2)
    )

    for index in range(2):
        assert store[f"evacuee:E{index}"]["current_stay"]["status"] == "cancelled"
        assert store[f"household:H{index}"]["status"] == "cancelled"
        row = await _row(_row_id(index))
        assert row["reconcile_outcome"] == "cancelled"
        assert row["reconciled_at"] is not None


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


async def test_written_row_alone_proves_the_group_reached_couch(db):
    await _insert_group(2)
    await _api_update({}, {"state": "written", **dict.fromkeys(PII)}, _row_id(0))
    await _reserve(0)
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_group(couch, BOOKING_ID) is True

    couch.bulk_docs.assert_awaited_once()  # not rejected, the pending person is written
    assert (await _row(_row_id(0)))["state"] == "written"


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


# R2/F3: skips that used to retry and log on every poll -----------------


async def _poll(couch, monkeypatch, polls: int) -> None:
    await inbound.run_external_booking_inbound_loop(
        couch, stop_event=_stop_after_polls(monkeypatch, polls)
    )


async def test_missing_shelter_database_is_backed_off_and_logged_once(
    db, monkeypatch, clock, caplog
):
    await _insert_group(2)
    couch = _couch(exists=False)

    await _poll(couch, monkeypatch, 5)

    assert couch.database_exists.await_count == 1  # polls 2-5 inside the backoff window
    assert caplog.text.count("missing for booking group") == 1
    assert (await _row(_row_id(0)))["state"] == "pending"


async def test_failed_duplicate_check_is_backed_off_and_logged_once(
    db, monkeypatch, clock, caplog
):
    await _insert_group(2)
    couch = _couch()
    couch.find = AsyncMock(side_effect=ValueError(_LEAK))

    await _poll(couch, monkeypatch, 5)

    assert couch.find.await_count == 1
    assert caplog.text.count("Duplicate check failed") == 1
    assert "attempt 1" in caplog.text
    _assert_no_pii_logged(caplog.text)
    couch.bulk_docs.assert_not_awaited()


async def test_pending_row_without_pii_is_backed_off_and_logged_once(
    db, monkeypatch, clock, caplog
):
    await _insert_group(2)
    await _api_update({}, {"cid": None}, _row_id(1))
    couch = _couch()

    await _poll(couch, monkeypatch, 5)

    assert couch.database_exists.await_count == 1
    assert caplog.text.count("no PII") == 1
    couch.bulk_docs.assert_not_awaited()


async def test_incomplete_group_is_not_backed_off(db, clock):
    """Usually a commit in flight: it must be re-checked on the very next poll."""
    await _insert_group(2)
    await _api_update({}, {"committed": False}, _row_id(1))
    tracker = FailureTracker()

    assert await _persist_group(_couch(), BOOKING_ID, health=tracker) is False

    assert tracker.ready(f"group:{BOOKING_ID}")


# R3/G1: the backoff can never overflow or kill the loop -----------------


def test_failure_tracker_never_overflows_however_often_a_key_fails(clock):
    tracker = FailureTracker()

    for _ in range(1100):  # `2 ** (count - 1)` overflowed a float at attempt 1025
        count, delay = tracker.failed("group:forever")

    assert (count, delay) == (1100, BACKOFF_MAX_SECONDS)
    assert not tracker.ready("group:forever")


def test_failure_tracker_stops_counting_at_its_cap(clock, monkeypatch):
    monkeypatch.setattr(inbound, "_MAX_TRACKED_FAILURES", 50)
    tracker = FailureTracker()

    results = [tracker.failed("group:forever") for _ in range(80)]

    assert results[-1] == (50, BACKOFF_MAX_SECONDS)


async def test_a_group_failing_over_a_thousand_times_keeps_the_poll_alive(
    db, monkeypatch, clock
):
    await _insert_group(1, booking_id="BK-BAD")
    await _insert(
        id="BP-ok",
        booking_id="BK-OK",
        cid_hash="hok",
        cid="1103700099999",
        person_seq=0,
    )
    due = await _find_due()
    seen: list[str] = []

    async def persist(_couch, booking_id, **_kwargs):
        if booking_id == "BK-BAD":
            raise ValueError("boom")
        seen.append(booking_id)
        return True

    monkeypatch.setattr(inbound, "_persist_group", persist)
    tracker = FailureTracker()

    for _ in range(1100):
        clock[0] += BACKOFF_MAX_SECONDS  # the retry is due again on every pass
        await inbound._run_poll(_couch(), due, tracker, asyncio.Event())

    assert seen == ["BK-OK"] * 1100  # the healthy group was served on every pass


async def test_a_failing_health_tracker_cannot_escape_the_poll(db, monkeypatch, caplog):
    await _insert_group(1, booking_id="BK-BAD")
    await _insert_written_group(1, prefix="W", booking_id="BK-CANCEL")
    due = await _find_due()
    monkeypatch.setattr(
        inbound, "_persist_group", AsyncMock(side_effect=ValueError("boom"))
    )
    monkeypatch.setattr(
        inbound, "_process_cancel", AsyncMock(side_effect=ValueError("boom"))
    )
    tracker = FailureTracker()
    monkeypatch.setattr(tracker, "failed", MagicMock(side_effect=OverflowError("x")))

    await inbound._run_poll(_couch(), due, tracker, asyncio.Event())  # must not raise

    assert caplog.text.count("Could not record failure") == 2


async def test_loop_survives_a_poll_pass_that_raises(db, monkeypatch, caplog):
    """No single failure of a pass may kill the task: the sweeper and later polls go on."""
    await _insert()
    real_run_poll = inbound._run_poll
    passes = [0]

    async def run_poll(*args, **kwargs):
        passes[0] += 1
        if passes[0] == 1:
            raise OverflowError(_LEAK)
        await real_run_poll(*args, **kwargs)

    monkeypatch.setattr(inbound, "_run_poll", run_poll)

    await inbound.run_external_booking_inbound_loop(
        _couch(), stop_event=_stop_after_polls(monkeypatch, 3)
    )

    assert passes[0] >= 3
    assert (await _row())["state"] == "written"  # a later pass still wrote the booking
    assert "OverflowError" in caplog.text
    _assert_no_pii_logged(caplog.text)
    assert "Traceback" not in caplog.text


async def test_poll_pass_failure_log_is_throttled(db, monkeypatch, clock, caplog):
    """R4/H7: a pass that keeps raising logs once per throttle window, not every poll."""

    async def run_poll(*_args, **_kwargs):
        raise OverflowError(_LEAK)

    monkeypatch.setattr(inbound, "_run_poll", run_poll)

    await _poll(_couch(), monkeypatch, 5)
    assert caplog.text.count("poll pass failed") == 1
    _assert_no_pii_logged(caplog.text)


# R3/G7: R1 reached-probe failure backs off (mutation M6) -----------------


async def test_failed_reached_probe_of_a_half_rejected_group_is_backed_off_and_logged_once(
    db, monkeypatch, clock, caplog
):
    await _insert_group(2)
    await _api_update(
        {"state": "pending"},
        {"state": "rejected", "reject_reason": "duplicate", **dict.fromkeys(PII)},
        _row_id(0),
    )
    await _reserve(1)  # the probe asks for reserved ids of the pending rows
    couch = _couch()
    couch.find = AsyncMock(side_effect=ValueError(_LEAK))

    await _poll(couch, monkeypatch, 5)

    assert couch.find.await_count == 1  # polls 2-5 fall inside the backoff window
    assert caplog.text.count("Duplicate check failed") == 1
    assert (await _row(_row_id(1)))["state"] == "pending"
    couch.bulk_docs.assert_not_awaited()
    _assert_no_pii_logged(caplog.text)

    clock[0] += BACKOFF_MAX_SECONDS
    await _poll(couch, monkeypatch, 1)
    assert couch.find.await_count == 2  # due again after the backoff


# R3/G3: a 409 must not overwrite a concurrent staff change ---------------


class _FakeCouch:
    """In-memory CouchDB behind `httpx.MockTransport`: GET/PUT with real `_rev` checks
    (409 on a stale one) and `_find` for household members. `before_put` lets a test play
    staff writing in between the worker's read and its write."""

    def __init__(self, docs):
        self.docs = {doc["_id"]: copy.deepcopy(doc) for doc in docs}
        self.revs = {doc_id: 1 for doc_id in self.docs}
        self.before_put: dict[str, object] = {}
        self.puts: list[str] = []

    def rev(self, doc_id):
        return f"{self.revs[doc_id]}-x"

    def staff_writes(self, doc_id, **changes):
        self.docs[doc_id].update(changes)
        self.revs[doc_id] += 1

    def client(self) -> CouchClient:
        settings = MagicMock(
            couch_base_url="http://couch:5984", couchdb_user="a", couchdb_password="b"
        )
        client = CouchClient(settings)
        client._client = httpx.AsyncClient(
            base_url="http://couch:5984", transport=httpx.MockTransport(self.handle)
        )
        return client

    def handle(self, request: httpx.Request) -> httpx.Response:
        parts = request.url.path.strip("/").split("/", 1)
        if len(parts) == 1:
            return httpx.Response(200, json={"db_name": parts[0]})
        doc_id = parts[1]
        if doc_id == "_find":
            body = json.loads(request.content)
            household = body["selector"]["household_id"]
            docs = [
                d
                for d in self.docs.values()
                if d.get("type") == "evacuee" and d.get("household_id") == household
            ]
            return httpx.Response(200, json={"docs": copy.deepcopy(docs)})
        if request.method == "GET":
            if doc_id not in self.docs:
                return httpx.Response(404, json={"error": "not_found"})
            return httpx.Response(
                200, json={**copy.deepcopy(self.docs[doc_id]), "_rev": self.rev(doc_id)}
            )
        hook = self.before_put.pop(doc_id, None)
        if hook:
            hook()
        body = json.loads(request.content)
        if doc_id in self.docs and body.get("_rev") != self.rev(doc_id):
            return httpx.Response(409, json={"error": "conflict"})
        self.puts.append(doc_id)
        self.revs[doc_id] = self.revs.get(doc_id, 0) + 1
        self.docs[doc_id] = {k: v for k, v in body.items() if k != "_rev"}
        return httpx.Response(
            201, json={"ok": True, "id": doc_id, "rev": self.rev(doc_id)}
        )


async def _fake_couch_with_stay(
    status="pre_registered",
) -> tuple[_FakeCouch, CouchClient]:
    fake = _FakeCouch(_stay_docs(1, status=status))
    return fake, fake.client()


async def test_conflict_with_a_concurrent_staff_check_in_does_not_overwrite_the_stay(
    db,
):
    booking = await _insert_written()
    fake, couch = await _fake_couch_with_stay()
    fake.before_put["evacuee:E1"] = lambda: fake.staff_writes(
        "evacuee:E1", current_stay={"status": "active", "zone": "A", "since": "now"}
    )

    assert await _process_cancel(couch, booking) is False  # re-checked next poll

    assert fake.docs["evacuee:E1"]["current_stay"]["status"] == "active"
    assert "evacuee:E1" not in fake.puts
    assert fake.docs["household:H1"]["status"] == "pre_registered"
    row = await _row()
    assert (row["state"], row["cancel_requested"]) == ("written", True)

    # The next poll reads the checked-in evacuee: nothing to cancel any more.
    assert await _process_cancel(couch, booking) is True
    row = await _row()
    assert (row["state"], row["reject_reason"]) == ("written", "not_cancellable")
    assert fake.docs["evacuee:E1"]["current_stay"]["status"] == "active"
    await couch.close()


async def test_conflict_with_an_unrelated_change_applies_the_cancel_on_the_fresh_doc(
    db,
):
    booking = await _insert_written()
    fake, couch = await _fake_couch_with_stay()
    fake.before_put["evacuee:E1"] = lambda: fake.staff_writes(
        "evacuee:E1", phone="0899999999"
    )

    assert await _process_cancel(couch, booking) is True

    evacuee = fake.docs["evacuee:E1"]
    assert evacuee["current_stay"]["status"] == "cancelled"
    assert evacuee["phone"] == "0899999999"  # staff's change survived the retry
    assert fake.docs["household:H1"]["status"] == "cancelled"
    assert (await _row())["state"] == "cancelled"
    await couch.close()


async def test_household_conflict_with_a_member_moved_in_is_not_cancelled(db):
    """Staff move another pre_registered member into the household between the worker's
    read and its write: the retry re-checks the members and leaves the household open."""
    booking = await _insert_written()
    fake, couch = await _fake_couch_with_stay()

    def staff_merges_a_member():
        fake.docs["evacuee:E2"] = {
            "_id": "evacuee:E2",
            "type": "evacuee",
            "household_id": "household:H1",
            "current_stay": {"status": "pre_registered"},
        }
        fake.revs["evacuee:E2"] = 1
        fake.staff_writes("household:H1", label="merged")

    fake.before_put["household:H1"] = staff_merges_a_member

    assert await _process_cancel(couch, booking) is True

    assert fake.docs["evacuee:E1"]["current_stay"]["status"] == "cancelled"
    assert fake.docs["household:H1"]["status"] == "pre_registered"
    assert "household:H1" not in fake.puts
    await couch.close()


async def test_household_conflict_with_unchanged_state_is_cancelled_on_the_fresh_rev(
    db,
):
    booking = await _insert_written()
    fake, couch = await _fake_couch_with_stay()
    fake.before_put["household:H1"] = lambda: fake.staff_writes(
        "household:H1", label="renamed"
    )

    assert await _process_cancel(couch, booking) is True

    household = fake.docs["household:H1"]
    assert household["status"] == "cancelled"
    assert household["label"] == "renamed"
    await couch.close()


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


async def test_logged_exception_keeps_the_innermost_frame_location_but_no_values(
    db, caplog
):
    """Review R2/F6: the traceback is dropped (it can carry values) but the operator
    still gets `file:function:line` of where the error was raised."""
    await _insert_group(2)
    couch = _couch()

    async def _find_boom(*_args, **_kwargs):
        raise ValueError(_LEAK)

    couch.find = _find_boom

    assert await _persist_group(couch, BOOKING_ID) is False

    match = re.search(
        r"error=ValueError at test_external_bookings_inbound\.py:_find_boom:(\d+)",
        caplog.text,
    )
    assert match, caplog.text
    assert "Traceback" not in caplog.text
    assert "bad doc" not in caplog.text  # the exception message is never logged
    _assert_no_pii_logged(caplog.text)


# ------------------------------------- CR-169 #612 review round 2: in-flight cancel tokens


async def _insert_tokened(
    *, row_id: str = BOOKING_ID, token: str = "req-1", set_at: datetime | None
) -> ExternalBooking:
    """A written row flagged by an EXT-009 request that still holds its token."""
    return await _insert(
        id=row_id,
        cid_hash=f"hash-{row_id}",
        state="written",
        cancel_requested=True,
        cancel_reason="partner cancel",
        cancel_flag_token=token,
        cancel_flag_set_at=set_at,
        cid=None,
        first_name=None,
        last_name=None,
        phone=None,
        evacuee_id="evacuee:E1",
        household_id="household:H1",
    )


async def test_due_selector_skips_flags_that_still_carry_a_token(db):
    """A tokened flag is owned by an in-flight request that may still revert it."""
    await _insert_tokened(set_at=datetime.now(UTC))
    await _insert(
        id="BP-untokened",
        cid_hash="h-untokened",
        state="written",
        cancel_requested=True,
    )
    assert [booking.id for booking in await _find_due()] == ["BP-untokened"]


async def test_process_cancel_never_acts_on_a_tokened_flag(db):
    booking = await _insert_tokened(set_at=datetime.now(UTC))
    couch = _couch(doc=_evacuee("pre_registered"))

    assert await _process_cancel(couch, booking) is True

    couch.get_doc.assert_not_awaited()
    couch.put_doc.assert_not_awaited()
    row = await _row()
    assert (row["state"], row["cancel_requested"], row["cancel_flag_token"]) == (
        "written",
        True,
        "req-1",
    )


async def test_untokened_flag_is_still_cancelled(db):
    """A flag whose request finished (token cleared) is processed exactly as before."""
    booking = await _insert_written()
    assert booking.cancel_flag_token is None
    assert [b.id for b in await _find_due()] == [BOOKING_ID]
    couch = _couch()
    couch.get_doc = AsyncMock(return_value=_evacuee("cancelled"))

    assert await _process_cancel(couch, booking) is True

    row = await _row()
    assert (row["state"], row["cancel_requested"]) == ("cancelled", False)


async def test_stale_token_is_reverted_without_cancelling_anything(db):
    """Older than the TTL: the request is gone and the partner never got a 200."""
    old = datetime.now(UTC) - timedelta(seconds=inbound.CANCEL_FLAG_TTL_SECONDS + 5)
    await _insert_tokened(set_at=old)

    assert await revert_abandoned_cancel_flags() == 1

    row = await _row()
    assert (
        row["state"],
        row["cancel_requested"],
        row["cancel_reason"],
        row["cancel_flag_token"],
        row["cancel_flag_set_at"],
    ) == ("written", False, None, None, None)
    assert row["updated_at"].replace(tzinfo=UTC) > old
    # Reverted, not cancelled: the row is open again and nothing is due for the worker.
    assert await _find_due() == []


async def test_fresh_token_is_not_reverted(db):
    await _insert_tokened(set_at=datetime.now(UTC) - timedelta(seconds=30))

    assert await revert_abandoned_cancel_flags() == 0

    row = await _row()
    assert (row["cancel_requested"], row["cancel_flag_token"]) == (True, "req-1")


async def test_token_without_set_time_falls_back_to_updated_at(db):
    """A tokened row lacking `cancel_flag_set_at` is aged by `updated_at` (OLD here)."""
    await _insert_tokened(set_at=None)

    assert await revert_abandoned_cancel_flags() == 1
    assert (await _row())["cancel_flag_token"] is None


async def test_stale_revert_is_guarded_on_the_observed_token(db, monkeypatch):
    """The request finishes between the worker's read and its write: the write misses."""
    old = datetime.now(UTC) - timedelta(seconds=inbound.CANCEL_FLAG_TTL_SECONDS + 5)
    await _insert_tokened(set_at=old)
    collection = ExternalBooking.get_pymongo_collection()
    real = type(collection).update_one

    async def commit_first(self, flt, *args, **kwargs):
        if self.name == collection.name and flt.get("cancel_flag_token") == "req-1":
            # The API's commit clears the token just before the worker's guarded write.
            await real(
                self,
                {"_id": BOOKING_ID},
                {"$set": {"cancel_flag_token": None, "cancel_flag_set_at": None}},
            )
        return await real(self, flt, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_one", commit_first)

    assert await revert_abandoned_cancel_flags() == 0

    row = await _row()
    # The committed flag survives and is now due for the normal cancel path.
    assert (row["cancel_requested"], row["cancel_flag_token"]) == (True, None)
    assert [b.id for b in await _find_due()] == [BOOKING_ID]


async def test_stale_revert_logs_booking_ids_only(db, caplog):
    old = datetime.now(UTC) - timedelta(seconds=inbound.CANCEL_FLAG_TTL_SECONDS + 5)
    await _insert_tokened(set_at=old)

    with caplog.at_level(logging.WARNING, logger=inbound.logger.name):
        await revert_abandoned_cancel_flags()

    text = "\n".join(record.getMessage() for record in caplog.records)
    assert BOOKING_ID in text
    for secret in (CID, PHONE, "สมชาย", "req-1"):
        assert secret not in text


async def test_loop_reverts_abandoned_flags_and_survives_its_failure(db, monkeypatch):
    monkeypatch.setattr(inbound, "POLL_INTERVAL_SECONDS", 0)
    calls: list[int] = []

    async def failing_revert():
        calls.append(1)
        raise RuntimeError("boom")

    monkeypatch.setattr(inbound, "revert_abandoned_cancel_flags", failing_revert)
    await _insert()
    stop = asyncio.Event()
    couch = _couch()

    async def bulk_then_stop(_database, docs):
        stop.set()
        return _bulk_ok(_database, docs)

    couch.bulk_docs = AsyncMock(side_effect=bulk_then_stop)

    await inbound.run_external_booking_inbound_loop(couch, stop_event=stop)

    assert calls
    assert (await _row())["state"] == "written"


# #613 reconcile pass over terminal rows -------------------------------------------


def _terminal(index: int, *, state: str = "cancelled", **overrides) -> dict:
    """Raw Mongo doc of a terminal row that reserved ids for person `index`."""
    return {
        "_id": _row_id(index),
        "booking_id": BOOKING_ID,
        "person_seq": index,
        "group_size": 1,
        "committed": True,
        "client_id": "client-abc",
        "module_name": "M2",
        "shelter_code": "SH001",
        "cid": None,
        "cid_hash": f"t{index}",
        "state": state,
        "cancel_requested": False,
        "evacuee_id": f"evacuee:E{index}",
        "household_id": f"household:H{index}",
        "created_at": OLD,
        "updated_at": OLD,
        **overrides,
    }


#: A timestamp the reconcile pass wrote on a doc (and recorded as that doc's marker), and
#: one written by staff — they never coincide (#613 review รอบ 3).
MARK_TS = "2026-10-17T03:00:00.123456Z"
STAFF_TS = "2026-10-17T04:00:00.654321Z"


def _no_markers(row: dict) -> bool:
    return (
        row.get("reconcile_stay_cancelled_at") is None
        and row.get("reconcile_household_cancelled_at") is None
    )


def _partner_audits(store: dict) -> list[str]:
    return [doc_id for doc_id in store if doc_id.startswith("audit:ext-cancel-")]


async def _insert_terminal(index: int = 0, **overrides) -> None:
    """Insert through the raw collection so a row can omit the reconcile fields (legacy)."""
    await ExternalBooking.get_pymongo_collection().insert_one(
        _terminal(index, **overrides)
    )


async def test_pre_registered_stay_of_a_cancelled_row_is_cancelled_and_stamped(db):
    await _insert_terminal(0)
    couch, store = _stored_couch(_stay_docs(0))

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert store["household:H0"]["status"] == "cancelled"
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "cancelled"
    assert row["reconciled_at"] is not None
    assert row["state"] == "cancelled"


async def test_rejected_row_with_a_reserved_stay_is_reconciled_too(db):
    await _insert_terminal(0, state="rejected", reject_reason="duplicate")
    couch, store = _stored_couch(_stay_docs(0))

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "cancelled"
    assert row["state"] == "rejected"


async def test_advanced_stay_is_never_touched_and_logged_without_pii(db, caplog):
    await _insert_terminal(0)
    couch, store = _stored_couch(_stay_docs(0, status="active"))
    caplog.set_level(logging.WARNING, logger=inbound.logger.name)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["evacuee:E0"]["current_stay"]["status"] == "active"
    assert store["household:H0"]["status"] == "pre_registered"
    couch.put_doc.assert_not_awaited()
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "advanced"
    assert row.get("reconcile_stay_cancelled_at") is None  # stay never cancelled
    assert inbound._household_audit_id("household:H0") not in store
    assert "left untouched" in caplog.text
    _assert_no_pii_logged(caplog.text)


async def test_docs_missing_is_stamped_missing(db):
    """No reserved doc in the shelter DB (an absent shelter DB answers 404 the same way)."""
    await _insert_terminal(0)
    couch, store = _stored_couch([])

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store == {}
    couch.put_doc.assert_not_awaited()
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "missing"
    assert row["reconciled_at"] is not None


async def test_already_cancelled_stay_and_household_with_their_audits_is_noop(db):
    """Both docs cancelled and audited (by the reconcile pass or the EXT-009 path)."""
    await _insert_terminal(0)
    docs = _stay_docs(0, status="cancelled")
    docs[1]["status"] = "cancelled"
    docs += [
        {"_id": inbound._stay_audit_id(_row_id(0))},
        {"_id": inbound._household_audit_id("household:H0")},
    ]
    couch, _store = _stored_couch(docs)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    couch.put_doc.assert_not_awaited()
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "noop"


async def test_marked_stay_without_its_audit_gets_the_audit_and_is_cancelled(db):
    """A cancel whose audit write failed in an earlier pass: each doc carries the timestamp
    recorded in its marker (`current_stay.since` / `updated_at`), so the audits are written
    now (deterministic ids, so a second pass would not duplicate them) and the row is
    `cancelled`."""
    await _insert_terminal(
        0,
        reconcile_stay_cancelled_at=MARK_TS,
        reconcile_household_cancelled_at=MARK_TS,
    )
    docs = _stay_docs(0, status="cancelled")
    docs[0]["current_stay"]["since"] = MARK_TS
    docs[1] |= {"status": "cancelled", "updated_at": MARK_TS}
    couch, store = _stored_couch(docs)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    audit = store[inbound._stay_audit_id(_row_id(0))]
    assert audit["target_type"] == "evacuee"
    assert audit["target_id"] == "evacuee:E0"
    assert audit["created_by"] == "partner:M2"
    assert inbound._household_audit_id("household:H0") in store
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "cancelled"


async def test_marked_household_without_its_audit_is_cancelled_outcome(db):
    """Household-only row: the household was cancelled by an earlier pass (marker set) but
    its audit is missing — the audit-retry pass stamps `cancelled`, not `noop`."""
    await _insert_terminal(0, evacuee_id=None, reconcile_household_cancelled_at=MARK_TS)
    couch, store = _stored_couch(
        [{**_stay_docs(0)[1], "status": "cancelled", "updated_at": MARK_TS}]
    )

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert (
        store[inbound._household_audit_id("household:H0")]["target_type"] == "household"
    )
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "cancelled"


async def test_staff_cancelled_stay_and_household_are_noop_without_a_partner_audit(db):
    """Both docs were cancelled by staff (no markers on the row): nothing to do, and no
    audit is written in the partner's name."""
    await _insert_terminal(0)
    docs = _stay_docs(0, status="cancelled")
    docs[1]["status"] = "cancelled"
    couch, store = _stored_couch(docs)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    couch.put_doc.assert_not_awaited()
    assert not [doc_id for doc_id in store if doc_id.startswith("audit:")]
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "noop"
    assert _no_markers(row)


async def test_staff_cancelled_household_only_row_is_noop_without_a_partner_audit(db):
    await _insert_terminal(0, evacuee_id=None)
    couch, store = _stored_couch([{**_stay_docs(0)[1], "status": "cancelled"}])

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    couch.put_doc.assert_not_awaited()
    assert inbound._household_audit_id("household:H0") not in store
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "noop"
    assert _no_markers(row)


async def test_staff_cancelled_stay_with_a_left_behind_household_cancels_only_the_household(
    db,
):
    """Staff cancelled the stay; the household is still pre_registered with no live member:
    the pass cancels it, marks the row and writes the household audit (no stay audit)."""
    await _insert_terminal(0)
    couch, store = _stored_couch(_stay_docs(0, status="cancelled"))

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["household:H0"]["status"] == "cancelled"
    assert inbound._household_audit_id("household:H0") in store
    assert inbound._stay_audit_id(_row_id(0)) not in store
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "cancelled"
    assert (
        row["reconcile_household_cancelled_at"] == store["household:H0"]["updated_at"]
    )
    assert row.get("reconcile_stay_cancelled_at") is None


async def test_marker_is_stamped_before_the_stay_is_cancelled(db):
    """Both markers are on the row before the CouchDB cancel of the stay is written, with
    the exact timestamp that write (and its household roll-up) uses (#613 r3)."""
    await _insert_terminal(0)
    couch, store = _stored_couch(_stay_docs(0))
    real_update = couch.update_doc.side_effect
    marker_seen: dict[str, object] = {}

    async def spy(database, doc_id, mutate, **kwargs):
        if doc_id == "evacuee:E0":
            row = await _row(_row_id(0))
            marker_seen["stay"] = row.get("reconcile_stay_cancelled_at")
            marker_seen["household"] = row.get("reconcile_household_cancelled_at")
        return await real_update(database, doc_id, mutate, **kwargs)

    couch.update_doc = AsyncMock(side_effect=spy)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert marker_seen["stay"] == store["evacuee:E0"]["current_stay"]["since"]
    assert marker_seen["household"] == store["household:H0"]["updated_at"]


async def test_household_only_row_cancelled_in_this_pass_is_cancelled_outcome(db):
    await _insert_terminal(0, evacuee_id=None)
    couch, store = _stored_couch([_stay_docs(0)[1]])

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["household:H0"]["status"] == "cancelled"
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "cancelled"


async def test_stay_audit_failure_after_the_cancel_is_retried_not_stamped(db):
    """Audit write fails after the stay was cancelled (transient): the row keeps no
    `reconciled_at`; the next pass writes the audit and stamps `cancelled`."""
    await _insert_terminal(0)
    couch, store = _stored_couch(_stay_docs(0))
    write = couch.put_doc.side_effect

    async def fail_audits(database, doc):
        if doc["_id"].startswith("audit:"):
            raise httpx.ConnectError("refused")
        return await write(database, doc)

    couch.put_doc = AsyncMock(side_effect=fail_audits)

    assert await inbound.reconcile_terminal_bookings(couch) == 0
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    row = await _row(_row_id(0))
    assert row.get("reconciled_at") is None
    assert row.get("reconcile_outcome") is None
    assert (
        row["reconcile_stay_cancelled_at"]
        == store["evacuee:E0"]["current_stay"]["since"]
    )

    couch.put_doc = AsyncMock(side_effect=write)
    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert inbound._stay_audit_id(_row_id(0)) in store
    assert store["household:H0"]["status"] == "cancelled"
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "cancelled"
    assert row["reconciled_at"] is not None


async def test_household_audit_failure_after_the_cancel_is_retried_not_stamped(db):
    await _insert_terminal(0, evacuee_id=None)
    couch, store = _stored_couch([_stay_docs(0)[1]])
    write = couch.put_doc.side_effect

    async def fail_audits(database, doc):
        if doc["_id"].startswith("audit:"):
            raise httpx.ConnectError("refused")
        return await write(database, doc)

    couch.put_doc = AsyncMock(side_effect=fail_audits)

    assert await inbound.reconcile_terminal_bookings(couch) == 0
    assert store["household:H0"]["status"] == "cancelled"
    row = await _row(_row_id(0))
    assert row.get("reconciled_at") is None
    assert (
        row["reconcile_household_cancelled_at"] == store["household:H0"]["updated_at"]
    )

    couch.put_doc = AsyncMock(side_effect=write)
    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert inbound._household_audit_id("household:H0") in store
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "cancelled"


@pytest.mark.parametrize(
    "status",
    [
        "pre_registered",
        "arriving",
        "active",
        "room_confirmed",
        "temporary_leave",
        "kiosk_registered",
    ],
)
async def test_reconcile_keeps_household_while_a_member_is_held(db, status):
    """schema.md §1.3 derive rules 2-4 (CR-169 #613): a household with another live member is kept, whatever its
    status (`pre_registered` included)."""
    await _insert_terminal(0)
    docs = _stay_docs(0)
    docs.append(
        {
            "_id": "evacuee:E9",
            "type": "evacuee",
            "shelter_code": "SH001",
            "household_id": "household:H0",
            "current_stay": {"status": status, "zone": None, "since": "x"},
        }
    )
    couch, store = _stored_couch(docs)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert store["household:H0"]["status"] == "pre_registered"
    assert store["evacuee:E9"]["current_stay"]["status"] == status
    assert inbound._household_audit_id("household:H0") not in store
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "cancelled"
    assert (
        row["reconcile_stay_cancelled_at"]
        == store["evacuee:E0"]["current_stay"]["since"]
    )


def _advanced_with_remaining(status: str) -> list[dict]:
    docs = _stay_docs(0, status="active")
    docs[0]["current_stay"]["status"] = status
    return docs


@pytest.mark.parametrize("status", ["checked_out", "transferred", "deceased"])
async def test_advanced_stay_not_live_cancels_the_household(db, status):
    """#683: the only remaining member is past pre_registered but not held → the
    household is cancelled (own marker + audit), not left pre_registered."""
    await _insert_terminal(0)
    couch, store = _stored_couch(_advanced_with_remaining(status))

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["evacuee:E0"]["current_stay"]["status"] == status
    assert store["household:H0"]["status"] == "cancelled"
    assert inbound._household_audit_id("household:H0") in store
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "cancelled"
    assert (
        row["reconcile_household_cancelled_at"] == store["household:H0"]["updated_at"]
    )
    assert row.get("reconcile_stay_cancelled_at") is None


async def test_advanced_stay_checked_out_keeps_household_with_a_live_sibling(db):
    await _insert_terminal(0)
    docs = _advanced_with_remaining("checked_out")
    docs.append(
        {
            "_id": "evacuee:E9",
            "type": "evacuee",
            "shelter_code": "SH001",
            "household_id": "household:H0",
            "current_stay": {"status": "active", "zone": None, "since": "x"},
        }
    )
    couch, store = _stored_couch(docs)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["household:H0"]["status"] == "pre_registered"
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "advanced"
    assert row.get("reconcile_stay_cancelled_at") is None
    assert inbound._household_audit_id("household:H0") not in store


def _http_status(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "http://couch/shelter_sh001")
    return httpx.HTTPStatusError(
        "boom", request=request, response=httpx.Response(code, request=request)
    )


def _http_503() -> httpx.HTTPStatusError:
    return _http_status(503)


@pytest.mark.parametrize(
    "make_error",
    [lambda: httpx.ConnectError("refused"), _http_503],
    ids=["connection", "5xx"],
)
async def test_transient_couch_error_leaves_the_row_for_the_next_pass(
    db, make_error, clock
):
    await _insert_terminal(0)
    couch, _store = _stored_couch(_stay_docs(0))
    couch.get_doc = AsyncMock(side_effect=make_error())

    assert await inbound.reconcile_terminal_bookings(couch) == 0
    row = await _row(_row_id(0))
    assert row.get("reconciled_at") is None
    assert row.get("reconcile_outcome") is None

    # The next reconcile cycle (RECONCILE_INTERVAL_SECONDS later) retries the row; no backoff.
    clock[0] += inbound.RECONCILE_INTERVAL_SECONDS
    couch, store = _stored_couch(_stay_docs(0))
    assert await inbound.reconcile_terminal_bookings(couch) == 1
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "cancelled"


async def test_failed_stay_write_is_retried_not_stamped(db):
    await _insert_terminal(0)
    couch, _store = _stored_couch(_stay_docs(0))
    couch.update_doc = AsyncMock(side_effect=httpx.ConnectError("refused"))

    assert await inbound.reconcile_terminal_bookings(couch) == 0

    assert (await _row(_row_id(0))).get("reconciled_at") is None


async def test_stay_changed_during_the_pass_is_retried_not_stamped(db):
    await _insert_terminal(0)
    couch, _store = _stored_couch(_stay_docs(0))
    couch.update_doc = AsyncMock(return_value=None)  # mutate declined: staff moved it

    assert await inbound.reconcile_terminal_bookings(couch) == 0

    assert (await _row(_row_id(0))).get("reconciled_at") is None


async def test_staff_check_in_race_on_the_stay_leaves_no_marker_and_no_partner_audit(
    db,
):
    """Path A (#613 r1/r3): the stay flips to `cancelled` by staff between the pass's read
    and its guarded write. Pass 1 retries; its stay marker lingers but does not match the
    staff `since`, so pass 2 writes no partner stay audit for the staff cancel."""
    await _insert_terminal(0)
    couch, store = _stored_couch(_stay_docs(0))
    real_update = couch.update_doc.side_effect

    async def staff_cancels_first(database, doc_id, mutate, **kwargs):
        if doc_id == "evacuee:E0":
            store[doc_id]["current_stay"] = {
                "status": "cancelled",
                "zone": None,
                "since": "x",
            }
        return await real_update(database, doc_id, mutate, **kwargs)

    couch.update_doc = AsyncMock(side_effect=staff_cancels_first)

    assert await inbound.reconcile_terminal_bookings(couch) == 0
    row = await _row(_row_id(0))
    assert row.get("reconciled_at") is None
    assert row["reconcile_stay_cancelled_at"] != "x"
    assert inbound._stay_audit_id(_row_id(0)) not in store

    # Pass 2 (the next cycle): the stay `since` is not the marker, so no stay audit. The
    # household is left behind and no member holds it, so the pass cancels only the household.
    couch, store = _stored_couch(
        [
            {**d, "current_stay": {"status": "cancelled", "zone": None, "since": "x"}}
            if d["_id"] == "evacuee:E0"
            else d
            for d in _stay_docs(0)
        ]
    )
    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert inbound._stay_audit_id(_row_id(0)) not in store
    assert store["household:H0"]["status"] == "cancelled"
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "cancelled"


async def test_declined_household_leaves_no_marker_and_a_later_staff_cancel_gets_no_audit(
    db,
):
    """Path C (#613 r1/r3): the household is held, so the pass cancels nothing; its
    household marker lingers. If the row is revisited after staff cancel the household (a
    staff `updated_at`), no partner household audit is written."""
    await _insert_terminal(0)
    docs = _stay_docs(0, status="cancelled")
    docs.append(
        {
            "_id": "evacuee:E9",
            "type": "evacuee",
            "shelter_code": "SH001",
            "household_id": "household:H0",
            "current_stay": {"status": "arriving", "zone": None, "since": "x"},
        }
    )
    couch, store = _stored_couch(docs)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["household:H0"]["status"] == "pre_registered"
    assert inbound._household_audit_id("household:H0") not in store
    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "noop"
    assert row["reconcile_household_cancelled_at"] is not None

    # Staff later cancels the household; the row is revisited (reconciled_at reset).
    store["household:H0"] |= {"status": "cancelled", "updated_at": STAFF_TS}
    store["evacuee:E9"]["current_stay"] = {
        "status": "cancelled",
        "zone": None,
        "since": "x",
    }
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": _row_id(0)}, {"$set": {"reconciled_at": None}}
    )
    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert inbound._household_audit_id("household:H0") not in store
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "noop"


async def test_marker_is_restamped_on_each_cancel_attempt(db):
    """A marker from an earlier attempt whose write never landed (the stay is still
    `pre_registered`) is replaced by the timestamp this attempt writes (#613 r3)."""
    await _insert_terminal(
        0,
        reconcile_stay_cancelled_at=MARK_TS,
        reconcile_household_cancelled_at=MARK_TS,
    )
    couch, store = _stored_couch(_stay_docs(0))

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    row = await _row(_row_id(0))
    since = store["evacuee:E0"]["current_stay"]["since"]
    assert since != MARK_TS
    assert row["reconcile_stay_cancelled_at"] == since
    assert (
        row["reconcile_household_cancelled_at"] == store["household:H0"]["updated_at"]
    )
    assert len(_partner_audits(store)) == 2


async def test_lingering_marker_after_a_failed_write_then_staff_cancel_is_noop(db):
    """#613 r3: pass 1 stamps the markers but its stay write fails; staff then cancel the
    stay and the household. Pass 2 finds both docs carrying staff timestamps, not the
    markers → `noop`, no partner audit."""
    await _insert_terminal(0)
    couch, _store = _stored_couch(_stay_docs(0))
    couch.update_doc = AsyncMock(side_effect=httpx.ConnectError("refused"))

    assert await inbound.reconcile_terminal_bookings(couch) == 0
    row = await _row(_row_id(0))
    assert row["reconcile_stay_cancelled_at"] is not None
    assert row["reconcile_household_cancelled_at"] is not None

    docs = _stay_docs(0, status="cancelled")
    docs[0]["current_stay"]["since"] = STAFF_TS
    docs[1] |= {"status": "cancelled", "updated_at": STAFF_TS}
    couch, store = _stored_couch(docs)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    couch.put_doc.assert_not_awaited()
    assert _partner_audits(store) == []
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "noop"


async def test_stay_cancelled_this_pass_with_a_staff_cancelled_household_audits_stay_only(
    db,
):
    """#613 r3: the pass cancels the stay; the household was already cancelled earlier by
    staff. The household's `updated_at` is not the marker → no partner household audit."""
    await _insert_terminal(0)
    docs = _stay_docs(0)
    docs[1] |= {"status": "cancelled", "updated_at": STAFF_TS}
    couch, store = _stored_couch(docs)

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert inbound._stay_audit_id(_row_id(0)) in store
    assert inbound._household_audit_id("household:H0") not in store
    assert store["household:H0"]["updated_at"] == STAFF_TS
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "cancelled"


async def test_row_moved_during_the_pass_is_not_overwritten(db):
    """The stamp is guarded on the observed state: a row the API flipped meanwhile keeps
    its own state and is left for the next pass."""
    await _insert_terminal(0)
    couch, _store = _stored_couch(_stay_docs(0))
    original_get = couch.get_doc.side_effect

    async def get_and_flip(database, doc_id):
        doc = await original_get(database, doc_id)
        await ExternalBooking.get_pymongo_collection().update_one(
            {"_id": _row_id(0)}, {"$set": {"state": "rejected"}}
        )
        return doc

    couch.get_doc = AsyncMock(side_effect=get_and_flip)

    assert await inbound.reconcile_terminal_bookings(couch) == 0

    row = await _row(_row_id(0))
    assert row["state"] == "rejected"
    assert row.get("reconciled_at") is None


async def test_concurrent_stamp_is_never_overwritten(db):
    await _insert_terminal(0)
    couch, _store = _stored_couch(_stay_docs(0))
    original_get = couch.get_doc.side_effect

    async def get_and_stamp_elsewhere(database, doc_id):
        doc = await original_get(database, doc_id)
        await ExternalBooking.get_pymongo_collection().update_one(
            {"_id": _row_id(0), "reconciled_at": None},
            {"$set": {"reconciled_at": OLD, "reconcile_outcome": "noop"}},
        )
        return doc

    couch.get_doc = AsyncMock(side_effect=get_and_stamp_elsewhere)

    assert await inbound.reconcile_terminal_bookings(couch) == 0

    row = await _row(_row_id(0))
    assert row["reconcile_outcome"] == "noop"
    assert row["reconciled_at"] == OLD.replace(tzinfo=None)  # Mongo returns naive UTC


async def test_legacy_row_without_the_reconcile_fields_is_reconciled(db):
    await _insert_terminal(0)  # no reconciled_at / reconcile_outcome key at all
    raw = await _row(_row_id(0))
    assert "reconciled_at" not in raw and "reconcile_outcome" not in raw
    couch, store = _stored_couch(_stay_docs(0))

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "cancelled"


async def test_only_unreconciled_terminal_rows_with_reserved_ids_are_selected(db):
    await _insert_terminal(0)  # selected
    await _insert_terminal(1, reconciled_at=OLD, reconcile_outcome="noop")  # done
    await _insert_terminal(2, evacuee_id=None, household_id=None)  # nothing reserved
    await _insert_terminal(3, state="written", cancel_requested=False)  # not terminal
    couch, store = _stored_couch([*_stay_docs(0), *_stay_docs(1)])

    assert await inbound.reconcile_terminal_bookings(couch) == 1

    asked = {
        call.args[1]
        for call in couch.get_doc.await_args_list
        if not call.args[1].startswith(
            "audit:"
        )  # audit-existence probes, not reserved ids
    }
    assert asked == {"evacuee:E0", "household:H0"}
    assert store["evacuee:E1"]["current_stay"]["status"] == "pre_registered"


async def test_second_pass_is_idempotent_and_makes_no_couch_calls(db):
    await _insert_terminal(0)
    couch, store = _stored_couch(_stay_docs(0))
    assert await inbound.reconcile_terminal_bookings(couch) == 1
    couch.get_doc.reset_mock()
    couch.put_doc.reset_mock()
    before = dict(store)

    assert await inbound.reconcile_terminal_bookings(couch) == 0

    couch.get_doc.assert_not_awaited()
    couch.put_doc.assert_not_awaited()
    assert store == before


async def test_persistently_failing_rows_do_not_starve_newer_healthy_rows(db, clock):
    """50 rows whose evacuee GET always 403s are older than one healthy row. The healthy
    row must still be reconciled on the next pass instead of waiting behind them."""
    failing = [f"evacuee:E{i}" for i in range(50)]
    for index in range(50):
        await _insert_terminal(index)  # updated_at OLD: oldest first
    await _insert_terminal(50, updated_at=datetime(2026, 10, 8, tzinfo=UTC))
    couch, _store = _stored_couch(
        [doc for index in range(51) for doc in _stay_docs(index)]
    )
    real_get = couch.get_doc.side_effect

    async def forbidden_for_failing(database, doc_id):
        if doc_id in failing:
            raise _http_status(403)
        return await real_get(database, doc_id)

    couch.get_doc = AsyncMock(side_effect=forbidden_for_failing)
    health = inbound.FailureTracker()

    assert await inbound.reconcile_terminal_bookings(couch, health) == 0
    assert len(health.keys("reconcile:")) == 50

    clock[0] += inbound.RECONCILE_INTERVAL_SECONDS  # next cycle
    assert await inbound.reconcile_terminal_bookings(couch, health) == 1

    healthy = await _row(_row_id(50))
    assert healthy["reconcile_outcome"] == "cancelled"
    assert (await _row(_row_id(0))).get("reconciled_at") is None


async def test_failing_row_is_retried_on_the_very_next_pass(db):
    """Decision #613: a transient failure is retried in the next reconcile cycle. No timer
    holds the row back, even on the immediately following pass."""
    await _insert_terminal(0)
    couch, store = _stored_couch(_stay_docs(0))
    real_get = couch.get_doc.side_effect
    failing = [True]

    async def flaky(database, doc_id):
        if failing[0] and doc_id == "evacuee:E0":
            raise _http_status(503)
        return await real_get(database, doc_id)

    couch.get_doc = AsyncMock(side_effect=flaky)
    health = inbound.FailureTracker()

    assert await inbound.reconcile_terminal_bookings(couch, health) == 0
    assert health.keys("reconcile:") == [f"reconcile:{_row_id(0)}"]

    failing[0] = False
    assert await inbound.reconcile_terminal_bookings(couch, health) == 1
    assert store["evacuee:E0"]["current_stay"]["status"] == "cancelled"
    assert (await _row(_row_id(0)))["reconcile_outcome"] == "cancelled"
    assert health.keys("reconcile:") == []


async def test_reconcile_pass_takes_at_most_one_batch_then_the_rest_next_pass(db):
    count = inbound.RECONCILE_BATCH_SIZE + 1
    docs: list[dict] = []
    for i in range(count):
        await _insert_terminal(i)
        docs.extend(_stay_docs(i))
    couch, _store = _stored_couch(docs)

    assert (
        await inbound.reconcile_terminal_bookings(couch) == inbound.RECONCILE_BATCH_SIZE
    )
    assert await inbound.reconcile_terminal_bookings(couch) == 1
    assert await inbound.reconcile_terminal_bookings(couch) == 0


async def test_reconcile_runs_at_most_once_per_interval_inside_the_loop(
    db, monkeypatch, clock
):
    calls: list[int] = []

    async def reconcile(_couch, _health=None):
        calls.append(1)
        return 0

    monkeypatch.setattr(inbound, "reconcile_terminal_bookings", reconcile)
    monkeypatch.setattr(inbound, "POLL_INTERVAL_SECONDS", 0)
    stop = asyncio.Event()
    polls = [0]

    async def sweep() -> int:
        polls[0] += 1
        clock[0] += 1  # 1 s per pass: far below the interval
        if polls[0] == 3:
            clock[0] += inbound.RECONCILE_INTERVAL_SECONDS  # a full minute passes
        if polls[0] > 4:
            stop.set()
        return 0

    monkeypatch.setattr(inbound, "sweep_stale_staged", sweep)
    await inbound.run_external_booking_inbound_loop(_couch(), stop_event=stop)

    assert len(calls) == 2  # first pass, then again once the interval elapsed


async def test_reconcile_failure_never_stops_the_loop(db, monkeypatch, caplog):
    async def boom(_couch, _health=None):
        raise RuntimeError("couch exploded")

    monkeypatch.setattr(inbound, "reconcile_terminal_bookings", boom)

    await inbound.run_external_booking_inbound_loop(
        _couch(), stop_event=_stop_after_polls(monkeypatch, 2)
    )

    assert "Terminal booking reconcile pass failed" in caplog.text
