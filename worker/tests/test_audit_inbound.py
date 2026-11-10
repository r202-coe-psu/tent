"""CR-231 S2 — inbound audit_events → CouchDB drops the whole `pii` key."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from tent_model import AuditEvent

from worker.inbound.audit import CENTRAL_OPS_DB, _persist_audit_event, audit_couch_doc


def _event(**over) -> AuditEvent:
    base = dict(  # noqa: C408
        id="audit:01TESTAUDIT000000000001",
        event_type="public.search",
        domain="public",
        occurred_at=datetime(2026, 11, 8, tzinfo=UTC),
        actor={"kind": "anonymous"},
        context={
            "query_kind": "phone",
            "query_hash": "abc",
            "ip_hash": "def",
            "result_count": 1,
            "purpose": "other",
            "consent_version": "search-v1",
        },
        pii={
            "searcher": {
                "first_name": "สมศรี",
                "last_name": "ใจดี",
                "phone": "0899999999",
            },
            "client_ip": "203.0.113.10",
            "purpose_note": "หาญาติ 0811111111",
        },
    )
    return AuditEvent(**{**base, **over})


@pytest.mark.usefixtures("db")
def test_couch_doc_has_no_pii_and_keeps_context():
    event = _event()
    doc = audit_couch_doc(event)
    assert "pii" not in doc and "synced_to_couch" not in doc
    assert doc["_id"] == event.id
    assert doc["type"] == "audit"
    assert doc["schema_v"] == 2
    assert doc["event_type"] == "public.search"
    assert doc["context"]["purpose"] == "other"
    assert doc["context"]["consent_version"] == "search-v1"
    text = str(doc)
    for secret in ("0899999999", "203.0.113.10", "สมศรี", "หาญาติ"):
        assert secret not in text


@pytest.mark.usefixtures("db")
async def test_persist_marks_synced_and_uses_mongo_id():
    event = await _event().insert()
    couch = MagicMock()
    couch.ensure_database = AsyncMock()
    couch.put_doc = AsyncMock(return_value={"ok": True})

    assert await _persist_audit_event(couch, event) is True
    couch.ensure_database.assert_awaited_once_with(CENTRAL_OPS_DB)
    db_name, doc = couch.put_doc.await_args.args
    assert db_name == CENTRAL_OPS_DB
    assert doc["_id"] == "audit:01TESTAUDIT000000000001"
    assert event.synced_to_couch is True
    assert (await AuditEvent.get(event.id)).synced_to_couch is True


@pytest.mark.usefixtures("db")
async def test_persist_failure_leaves_unsynced():
    event = await _event().insert()
    couch = MagicMock()
    couch.ensure_database = AsyncMock()
    couch.put_doc = AsyncMock(side_effect=RuntimeError("couch down"))

    assert await _persist_audit_event(couch, event) is False
    assert event.synced_to_couch is False
    assert (await AuditEvent.get(event.id)).synced_to_couch is False


@pytest.mark.usefixtures("db")
async def test_unreadable_row_is_skipped_not_blocking():
    from worker.inbound.audit import sync_pending

    good = await _event().insert()
    await AuditEvent.get_pymongo_collection().insert_one(
        {
            "_id": "audit:01BAD",
            "event_type": "future.thing",
            "domain": "public",
            "occurred_at": datetime(2026, 11, 8, tzinfo=UTC),
            "actor": {"kind": "system"},
            "context": {},
            "synced_to_couch": False,
        }
    )
    couch = MagicMock()
    couch.ensure_database = AsyncMock()
    couch.put_doc = AsyncMock(return_value={"ok": True})

    import asyncio

    await sync_pending(couch, stop_event=asyncio.Event())
    assert couch.put_doc.await_count == 1
    assert (await AuditEvent.get(good.id)).synced_to_couch is True


@pytest.mark.usefixtures("db")
async def test_mark_synced_failure_returns_false_without_raising(monkeypatch):
    event = await _event().insert()

    async def boom(*args, **kwargs):
        raise RuntimeError("mongo down")

    monkeypatch.setattr(AuditEvent, "set", boom)
    couch = MagicMock()
    couch.ensure_database = AsyncMock()
    couch.put_doc = AsyncMock(return_value={"ok": True})
    assert await _persist_audit_event(couch, event) is False
