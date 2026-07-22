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
