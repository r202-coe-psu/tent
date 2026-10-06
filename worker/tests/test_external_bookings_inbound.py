"""Tests for the partner booking inbound loop (CR-154 C6, FR-50..54 / FR-62).

State tests run against the real test Mongo (``db`` fixture) because the point of the
worker's writes is that they are conditional on the row's current state — the API
mutates the same rows concurrently (EXT-009 cancel).
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from tent_model import ExternalBooking

from worker.inbound.external_bookings import (
    HOLD_STATUSES,
    _persist_booking,
    _process_cancel,
    build_evacuee_doc,
    build_household_doc,
    partner_actor,
)

CID = "1103700012345"
PHONE = "0812345678"
DB = "shelter_sh001"
BOOKING_ID = "BK-01TEST"
PII = ("cid", "first_name", "last_name", "phone")


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
        "created_at": datetime(2026, 10, 6, tzinfo=UTC),
        "updated_at": datetime(2026, 10, 6, tzinfo=UTC),
    }
    fields.update(overrides)
    booking = ExternalBooking(**fields)
    await booking.insert()
    return booking


async def _row() -> dict:
    row = await ExternalBooking.get_pymongo_collection().find_one({"_id": BOOKING_ID})
    assert row is not None
    return row


async def _api_update(guard: dict, changes: dict) -> None:
    """Simulate the API's guarded EXT-009 write on the raw collection."""
    result = await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": BOOKING_ID, **guard}, {"$set": changes}
    )
    assert result.matched_count == 1


async def _api_cancel_pending() -> None:
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
    )


def _couch(*, exists=True, find=None, bulk=None, doc=None):
    couch = MagicMock()
    couch.database_exists = AsyncMock(return_value=exists)
    couch.find = AsyncMock(return_value=find or [])
    couch.bulk_docs = AsyncMock(
        return_value=bulk
        if bulk is not None
        else [
            {"ok": True, "id": "h", "rev": "1-a"},
            {"ok": True, "id": "e", "rev": "1-b"},
        ]
    )
    couch.get_doc = AsyncMock(return_value=doc)
    couch.put_doc = AsyncMock(return_value={"ok": True})
    return couch


def _assert_pii_cleared(row: dict) -> None:
    for key in PII:
        assert row[key] is None, key


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
        created_by="partner:M2",
        now="2026-10-06T00:00:00Z",
    )
    assert doc["_id"] == "evacuee:E1"
    assert doc["type"] == "evacuee"
    assert doc["schema_v"] == 12
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
    booking = await _insert()
    couch = _couch()

    assert await _persist_booking(couch, booking) is True

    row = await _row()
    assert row["evacuee_id"].startswith("evacuee:")
    assert row["household_id"].startswith("household:")
    selector = couch.find.await_args.args[1]
    assert selector["person_id.number"] == CID
    assert selector["current_stay.status"] == {"$in": list(HOLD_STATUSES)}
    assert selector["_id"] == {"$ne": row["evacuee_id"]}

    db_name, docs = couch.bulk_docs.await_args.args
    assert db_name == DB
    household, evacuee = docs
    assert household["type"] == "household"
    assert household["_id"] == row["household_id"]
    assert household["head_evacuee_id"] == row["evacuee_id"]
    assert evacuee["_id"] == row["evacuee_id"]
    assert evacuee["gender"] is None
    assert evacuee["registered_via"] == "api"
    assert evacuee["schema_v"] == 12
    assert evacuee["person_id"]["number"] == CID
    assert evacuee["created_by"] == "partner:M2"
    assert household["created_by"] == "partner:M2"

    assert row["state"] == "written"
    assert row["cancel_requested"] is False
    _assert_pii_cleared(row)
    assert booking.state == "written"
    assert booking.cid is None


async def test_no_module_falls_back_to_client_id(db):
    booking = await _insert(module_name=None)
    couch = _couch()

    assert await _persist_booking(couch, booking) is True
    _, docs = couch.bulk_docs.await_args.args
    assert {d["created_by"] for d in docs} == {"partner:client-abc"}


async def test_retry_reuses_reserved_ids(db):
    booking = await _insert(evacuee_id="evacuee:E1", household_id="household:H1")
    couch = _couch()

    assert await _persist_booking(couch, booking) is True
    _, docs = couch.bulk_docs.await_args.args
    assert [d["_id"] for d in docs] == ["household:H1", "evacuee:E1"]
    assert (await _row())["state"] == "written"


async def test_missing_database_retries_later(db):
    booking = await _insert()
    couch = _couch(exists=False)

    assert await _persist_booking(couch, booking) is False
    row = await _row()
    assert row["state"] == "pending"
    assert row["cid"] == CID
    assert row["evacuee_id"] is None
    couch.bulk_docs.assert_not_awaited()


async def test_cancelled_before_reserve_never_touches_couch(db):
    booking = await _insert()  # poll read it as pending...
    await _api_cancel_pending()  # ...then the partner cancelled
    couch = _couch()

    assert await _persist_booking(couch, booking) is True

    couch.find.assert_not_awaited()
    couch.bulk_docs.assert_not_awaited()
    row = await _row()
    assert row["state"] == "cancelled"
    assert row["cancel_reason"] == "partner cancel"
    assert row["evacuee_id"] is None
    _assert_pii_cleared(row)


async def test_cancelled_during_write_is_routed_to_cancel(db):
    booking = await _insert()
    couch = _couch()

    async def bulk_then_api_cancels(*_args):
        await _api_cancel_pending()
        return [
            {"ok": True, "id": "h", "rev": "1-a"},
            {"ok": True, "id": "e", "rev": "1-b"},
        ]

    couch.bulk_docs = AsyncMock(side_effect=bulk_then_api_cancels)

    assert await _persist_booking(couch, booking) is True

    row = await _row()
    assert row["state"] == "written"
    assert row["cancel_requested"] is True
    assert row["cancel_reason"] == "partner cancel"
    assert row["evacuee_id"].startswith("evacuee:")
    _assert_pii_cleared(row)


async def test_duplicate_rejects_and_clears_pii(db):
    booking = await _insert()
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_booking(couch, booking) is True
    row = await _row()
    assert row["state"] == "rejected"
    assert row["reject_reason"] == "duplicate"
    _assert_pii_cleared(row)
    couch.bulk_docs.assert_not_awaited()


async def test_duplicate_after_api_cancel_keeps_cancelled(db):
    booking = await _insert(evacuee_id="evacuee:E1", household_id="household:H1")
    couch = _couch()

    async def find_then_api_cancels(*_args, **_kwargs):
        await _api_cancel_pending()
        return [{"_id": "evacuee:OTHER"}]

    couch.find = AsyncMock(side_effect=find_then_api_cancels)

    assert await _persist_booking(couch, booking) is True
    row = await _row()
    assert row["state"] == "cancelled"
    assert row["reject_reason"] is None


async def test_bulk_conflict_counts_as_written(db):
    booking = await _insert(evacuee_id="evacuee:E1", household_id="household:H1")
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

    assert await _persist_booking(couch, booking) is True
    row = await _row()
    assert row["state"] == "written"
    _assert_pii_cleared(row)


async def test_bulk_other_error_keeps_pending(db, caplog):
    booking = await _insert()
    couch = _couch(
        bulk=[
            {"ok": True, "id": "household:H1", "rev": "1-a"},
            {"id": "evacuee:E1", "error": "forbidden", "reason": "nope"},
        ]
    )

    assert await _persist_booking(couch, booking) is False
    row = await _row()
    assert row["state"] == "pending"
    assert row["cid"] == CID
    # PII never reaches the logs.
    assert CID not in caplog.text
    assert PHONE not in caplog.text


async def test_bulk_exception_keeps_pending(db):
    booking = await _insert()
    couch = _couch()
    couch.bulk_docs = AsyncMock(side_effect=RuntimeError("boom"))

    assert await _persist_booking(couch, booking) is False
    row = await _row()
    assert row["state"] == "pending"
    assert row["cid"] == CID


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
