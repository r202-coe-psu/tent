"""Tests for the partner booking inbound loop (CR-154 C6, FR-50..54 / FR-62)."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.inbound.external_bookings import (
    HOLD_STATUSES,
    _persist_booking,
    _process_cancel,
    build_evacuee_doc,
    build_household_doc,
    partner_actor,
)

CID = "1103700012345"
DB = "shelter_sh001"


def _booking(**overrides):
    booking = SimpleNamespace(
        id="BK-01TEST",
        booking_id="BK-01TEST",
        client_id="client-abc",
        module_name="M2",
        shelter_code="SH001",
        cid=CID,
        cid_hash="hash",
        first_name="สมชาย",
        last_name="ใจดี",
        phone="0812345678",
        state="pending",
        cancel_requested=False,
        cancel_reason=None,
        reject_reason=None,
        evacuee_id=None,
        household_id=None,
        created_at=datetime(2026, 10, 6, tzinfo=UTC),
        updated_at=datetime(2026, 10, 6, tzinfo=UTC),
        save=AsyncMock(),
    )
    for key, value in overrides.items():
        setattr(booking, key, value)

    def clear_pii():
        booking.cid = None
        booking.first_name = None
        booking.last_name = None
        booking.phone = None

    booking.clear_pii = clear_pii
    return booking


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


def _assert_pii_cleared(booking):
    assert booking.cid is None
    assert booking.first_name is None
    assert booking.last_name is None
    assert booking.phone is None


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
        phone="0812345678",
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


@pytest.mark.asyncio
async def test_pending_booking_written_and_pii_cleared():
    booking = _booking()
    couch = _couch()

    assert await _persist_booking(couch, booking) is True

    assert booking.evacuee_id.startswith("evacuee:")
    assert booking.household_id.startswith("household:")
    selector = couch.find.await_args.args[1]
    assert selector["person_id.number"] == CID
    assert selector["current_stay.status"] == {"$in": list(HOLD_STATUSES)}
    assert selector["_id"] == {"$ne": booking.evacuee_id}

    db, docs = couch.bulk_docs.await_args.args
    assert db == DB
    household, evacuee = docs
    assert household["type"] == "household"
    assert household["_id"] == booking.household_id
    assert household["head_evacuee_id"] == booking.evacuee_id
    assert evacuee["_id"] == booking.evacuee_id
    assert evacuee["gender"] is None
    assert evacuee["registered_via"] == "api"
    assert evacuee["schema_v"] == 12
    assert evacuee["person_id"]["number"] == CID
    assert evacuee["created_by"] == "partner:M2"
    assert household["created_by"] == "partner:M2"

    assert booking.state == "written"
    _assert_pii_cleared(booking)
    # Once to reserve ids before Couch, once after the write.
    assert booking.save.await_count == 2


@pytest.mark.asyncio
async def test_no_module_falls_back_to_client_id():
    booking = _booking(module_name=None)
    couch = _couch()

    assert await _persist_booking(couch, booking) is True
    _, docs = couch.bulk_docs.await_args.args
    assert {d["created_by"] for d in docs} == {"partner:client-abc"}


@pytest.mark.asyncio
async def test_retry_reuses_reserved_ids():
    booking = _booking(evacuee_id="evacuee:E1", household_id="household:H1")
    couch = _couch()

    assert await _persist_booking(couch, booking) is True
    _, docs = couch.bulk_docs.await_args.args
    assert [d["_id"] for d in docs] == ["household:H1", "evacuee:E1"]
    booking.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_missing_database_retries_later():
    booking = _booking()
    couch = _couch(exists=False)

    assert await _persist_booking(couch, booking) is False
    assert booking.state == "pending"
    assert booking.cid == CID
    couch.bulk_docs.assert_not_awaited()
    booking.save.assert_not_awaited()


@pytest.mark.asyncio
async def test_duplicate_rejects_and_clears_pii():
    booking = _booking()
    couch = _couch(find=[{"_id": "evacuee:OTHER"}])

    assert await _persist_booking(couch, booking) is True
    assert booking.state == "rejected"
    assert booking.reject_reason == "duplicate"
    _assert_pii_cleared(booking)
    couch.bulk_docs.assert_not_awaited()


@pytest.mark.asyncio
async def test_bulk_conflict_counts_as_written():
    booking = _booking(evacuee_id="evacuee:E1", household_id="household:H1")
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
    assert booking.state == "written"
    _assert_pii_cleared(booking)


@pytest.mark.asyncio
async def test_bulk_other_error_keeps_pending(caplog):
    booking = _booking()
    couch = _couch(
        bulk=[
            {"ok": True, "id": "household:H1", "rev": "1-a"},
            {"id": "evacuee:E1", "error": "forbidden", "reason": "nope"},
        ]
    )

    assert await _persist_booking(couch, booking) is False
    assert booking.state == "pending"
    assert booking.cid == CID
    # PII never reaches the logs.
    assert CID not in caplog.text
    assert "0812345678" not in caplog.text


@pytest.mark.asyncio
async def test_bulk_exception_keeps_pending():
    booking = _booking()
    couch = _couch()
    couch.bulk_docs = AsyncMock(side_effect=RuntimeError("boom"))

    assert await _persist_booking(couch, booking) is False
    assert booking.state == "pending"
    assert booking.cid == CID


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


def _written_booking():
    return _booking(
        state="written",
        cancel_requested=True,
        cid=None,
        first_name=None,
        last_name=None,
        phone=None,
        evacuee_id="evacuee:E1",
        household_id="household:H1",
    )


@pytest.mark.asyncio
async def test_cancel_pre_registered_evacuee():
    booking = _written_booking()
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

    assert booking.state == "cancelled"
    assert booking.cancel_requested is False
    booking.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancel_keeps_household_when_other_member_pre_registered():
    booking = _written_booking()
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
    assert booking.state == "cancelled"


@pytest.mark.asyncio
async def test_cancel_active_evacuee_not_cancellable():
    booking = _written_booking()
    couch = _couch(doc=_evacuee("active"))

    assert await _process_cancel(couch, booking) is True
    couch.put_doc.assert_not_awaited()
    assert booking.state == "written"
    assert booking.cancel_requested is False
    assert booking.reject_reason == "not_cancellable"


@pytest.mark.asyncio
async def test_cancel_evacuee_put_failure_retries():
    booking = _written_booking()
    couch = _couch(doc=_evacuee("pre_registered"))
    couch.put_doc = AsyncMock(side_effect=RuntimeError("boom"))

    assert await _process_cancel(couch, booking) is False
    assert booking.state == "written"
    assert booking.cancel_requested is True
    booking.save.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_already_cancelled_stay_finishes_booking():
    booking = _written_booking()
    couch = _couch(doc=_evacuee("cancelled"))

    assert await _process_cancel(couch, booking) is True
    couch.put_doc.assert_not_awaited()
    assert booking.state == "cancelled"
    assert booking.cancel_requested is False
