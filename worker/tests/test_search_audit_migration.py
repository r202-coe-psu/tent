"""CR-231 S7 — one-off `search_audits` → `audit_events`."""

from datetime import UTC, datetime

import pytest
from tent_model import AuditEvent, SearchAudit

from worker.cli.migrate_search_audits import migrate

NOW = datetime(2026, 11, 8, tzinfo=UTC)


@pytest.fixture
async def source(db):
    col = SearchAudit.get_pymongo_collection()
    await col.delete_many({})
    await col.insert_many(
        [
            {  # v1: hash only
                "_id": "search_audit:01V1",
                "query_kind": "phone",
                "query_hash": "h1",
                "ip_hash": "i1",
                "result_count": 2,
                "occurred_at": NOW,
                "synced_to_couch": True,
            },
            {  # v2: searcher + purpose
                "_id": "search_audit:01V2",
                "query_kind": "name",
                "query_hash": "h2",
                "ip_hash": "i2",
                "result_count": 0,
                "occurred_at": NOW,
                "synced_to_couch": False,
                "searcher": {
                    "first_name": "สมชาย",
                    "last_name": "",
                    "phone": "0812345678",
                },
                "client_ip": "203.0.113.10",
                "purpose": "other",
                "purpose_note": "หาญาติ",
                "consent_version": "search-v1",
            },
        ]
    )
    yield col
    await col.delete_many({})


async def test_migrates_v1_and_v2_rows(source):
    inserted, skipped = await migrate(source.database)
    assert (inserted, skipped) == (2, 0)

    v1 = await AuditEvent.get("audit:01V1")
    assert v1.event_type == "public.search" and v1.domain == "public"
    assert v1.context == {
        "query_kind": "phone",
        "query_hash": "h1",
        "ip_hash": "i1",
        "result_count": 2,
    }
    assert v1.pii is None and v1.synced_to_couch is True

    v2 = await AuditEvent.get("audit:01V2")
    assert v2.context["purpose"] == "other"
    assert v2.context["consent_version"] == "search-v1"
    assert v2.pii["client_ip"] == "203.0.113.10"
    assert v2.pii["searcher"]["first_name"] == "สมชาย"
    assert v2.pii["purpose_note"] == "หาญาติ"
    assert v2.synced_to_couch is False


async def test_rerun_is_idempotent_and_source_untouched(source):
    await migrate(source.database)
    assert await migrate(source.database) == (0, 2)
    assert await AuditEvent.find_all().count() == 2
    assert await source.count_documents({}) == 2


async def test_partial_pii_row_migrates_and_reads_back(db):
    col = SearchAudit.get_pymongo_collection()
    await col.insert_one(
        {
            "_id": "search_audit:01PART",
            "query_kind": "phone",
            "query_hash": "h",
            "ip_hash": "i",
            "result_count": 0,
            "occurred_at": NOW,
            "client_ip": "203.0.113.10",
        }
    )
    assert await migrate(col.database) == (1, 0)
    event = await AuditEvent.get("audit:01PART")
    assert event.pii["client_ip"] == "203.0.113.10"
    assert event.pii["searcher"] is None


async def test_row_missing_fields_is_skipped_not_fatal(source):
    await source.insert_one({"_id": "search_audit:01BROKEN", "occurred_at": NOW})
    inserted, skipped = await migrate(source.database)
    assert (inserted, skipped) == (2, 1)
    assert await AuditEvent.get("audit:01BROKEN") is None
