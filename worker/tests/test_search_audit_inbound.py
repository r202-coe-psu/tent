"""Tests for inbound search_audit persistence helpers."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.inbound.search_audit import CENTRAL_OPS_DB, _persist_search_audit


@pytest.mark.asyncio
async def test_persist_search_audit_marks_synced():
    audit = SimpleNamespace(
        id="search_audit:01TESTAUDIT000000000001",
        query_kind="phone",
        query_hash="abc",
        ip_hash="def",
        result_count=1,
        occurred_at=datetime(2026, 7, 22, tzinfo=UTC),
        synced_to_couch=False,
        save=AsyncMock(),
    )

    couch = MagicMock()
    couch.ensure_database = AsyncMock()
    couch.put_doc = AsyncMock(return_value={"ok": True, "id": audit.id, "rev": "1-x"})

    ok = await _persist_search_audit(couch, audit)  # type: ignore[arg-type]
    assert ok is True
    couch.ensure_database.assert_awaited_once_with(CENTRAL_OPS_DB)
    couch.put_doc.assert_awaited_once()
    put_args = couch.put_doc.await_args
    assert put_args.args[0] == CENTRAL_OPS_DB
    doc = put_args.args[1]
    assert doc["type"] == "search_audit"
    assert doc["query_kind"] == "phone"
    assert doc["query_hash"] == "abc"
    assert audit.synced_to_couch is True
    audit.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_persist_search_audit_strips_pii_before_couch():
    """CR-231 S2: searcher / client_ip / purpose_note never reach CouchDB; purpose + consent_version do."""
    audit = SimpleNamespace(
        id="search_audit:01TESTAUDIT000000000002",
        query_kind="phone",
        query_hash="abc",
        ip_hash="def",
        result_count=1,
        occurred_at=datetime(2026, 11, 6, tzinfo=UTC),
        synced_to_couch=False,
        searcher={"first_name": "สมศรี", "last_name": "ใจดี", "phone": "0899999999"},
        client_ip="203.0.113.10",
        purpose="other",
        purpose_note="หาญาติ 0811111111",
        consent_version="search-v1",
        save=AsyncMock(),
    )
    couch = MagicMock()
    couch.ensure_database = AsyncMock()
    couch.put_doc = AsyncMock(return_value={"ok": True, "id": audit.id, "rev": "1-x"})

    assert await _persist_search_audit(couch, audit) is True  # type: ignore[arg-type]
    doc = couch.put_doc.await_args.args[1]
    assert doc["schema_v"] == 2
    assert doc["purpose"] == "other"
    assert doc["consent_version"] == "search-v1"
    for pii in ("searcher", "client_ip", "purpose_note"):
        assert pii not in doc
    assert "0899999999" not in str(doc)
    assert "203.0.113.10" not in str(doc)


@pytest.mark.asyncio
async def test_persist_search_audit_v1_row_has_no_new_fields():
    audit = SimpleNamespace(
        id="search_audit:01TESTAUDIT000000000003",
        query_kind="phone",
        query_hash="abc",
        ip_hash="def",
        result_count=0,
        occurred_at=datetime(2026, 7, 22, tzinfo=UTC),
        synced_to_couch=False,
        purpose=None,
        consent_version=None,
        save=AsyncMock(),
    )
    couch = MagicMock()
    couch.ensure_database = AsyncMock()
    couch.put_doc = AsyncMock(return_value={"ok": True})
    assert await _persist_search_audit(couch, audit) is True  # type: ignore[arg-type]
    doc = couch.put_doc.await_args.args[1]
    assert "purpose" not in doc and "consent_version" not in doc
