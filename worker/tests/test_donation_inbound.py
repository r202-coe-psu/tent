"""Timestamps on public donations copied from Mongo into CouchDB."""

from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.inbound.donations import (
    _persist_donation,
    auto_approved_lines,
    campaign_auto_approve_audit_id,
)
from worker.masking import sha256_hex
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


def _buffer(*, phone: str = "0812345678") -> SimpleNamespace:
    return SimpleNamespace(
        id="donation:01TESTDONATION0000000001",
        shelter_code="SH001",
        campaign_id=None,
        created_at=datetime(2026, 9, 25, 21, 20, 18, 908000),
        expires_at=datetime(2026, 9, 28, 21, 20, 18, 908000),
        booking_ref="DN-123456",
        tracking_token_hash="hash",
        donor=SimpleNamespace(name="ทดสอบ", phone=phone, line_id=None, email=None),
        items_declared=[],
        logistics=None,
        status="pending_review",
        revisions=[],
        photos=[],
        photos_linked=True,
        synced_to_couch=False,
        save=AsyncMock(),
    )


async def _persisted_doc(donation: SimpleNamespace) -> dict:
    couch = MagicMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.put_doc = AsyncMock(return_value={"ok": True})

    assert await _persist_donation(couch, donation) is True  # type: ignore[arg-type]
    return couch.put_doc.await_args.args[1]


@pytest.mark.asyncio
async def test_persisted_donation_timestamps_carry_z_when_mongo_returns_naive():
    doc = await _persisted_doc(_buffer())
    assert doc["created_at"] == "2026-09-25T21:20:18.908Z"
    assert doc["declared_at"] == "2026-09-25T21:20:18.908Z"
    assert doc["expires_at"] == "2026-09-28T21:20:18.908Z"
    assert doc["updated_at"].endswith("Z")


@pytest.mark.asyncio
@pytest.mark.parametrize("phone", ["0812345678", "081-234-5678", "+66812345678"])
async def test_phone_hash_is_of_the_normalized_number(phone: str):
    """CR-173 FR-13 — every way of writing one number hashes alike, as the backend does."""
    doc = await _persisted_doc(_buffer(phone=phone))
    assert doc["donor"]["phone_hash"] == sha256_hex("0812345678")
    # The number itself is copied as typed; only the hash is normalized.
    assert doc["donor"]["phone"] == phone


def _buffer_row(**overrides):
    row = {
        "id": "01TESTDONATION0000000002",
        "shelter_code": "SH001",
        "campaign_id": None,
        "created_at": datetime(2026, 10, 21, 3, 0, 0, tzinfo=UTC),
        "expires_at": None,
        "booking_ref": "DN-654321",
        "tracking_token_hash": "hash",
        "donor": SimpleNamespace(
            name="ทดสอบ", phone="0812345678", line_id=None, email=None
        ),
        "items_declared": [],
        "logistics": None,
        "status": "pending_review",
        "revisions": [],
        "photos": [],
        "photos_linked": True,
        "synced_to_couch": False,
        "save": AsyncMock(),
    }
    row.update(overrides)
    return SimpleNamespace(**row)


def _couch(bulk_rows=None):
    couch = MagicMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.put_doc = AsyncMock(return_value={"ok": True})
    couch.bulk_docs = AsyncMock(return_value=bulk_rows or [{"id": "x", "rev": "1-a"}])
    return couch


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
async def test_persisted_donation_is_stamped_schema_v9():
    # CR-175 donor photos: photos (8 was CR-196's items[].line_key).
    # Must match the walk-in writer in the frontend — both channels write the same version.
    couch = _couch()

    assert await _persist_donation(couch, _buffer_row()) is True  # type: ignore[arg-type]
    doc = couch.put_doc.await_args.args[1]
    assert doc["_id"] == "donation:01TESTDONATION0000000002"
    assert doc["schema_v"] == 9
    # No photos on the booking → no `photos` field on the doc (optional, schema.md §2.3).
    assert "photos" not in doc
    # Nothing is rejected at intake — the fields only appear once staff review it.
    assert "reject_reason" not in doc
    assert "reject_reason_code" not in doc


@pytest.mark.asyncio
async def test_persisted_donation_carries_the_line_review_and_status():
    couch = _couch()
    row = _buffer_row(items_declared=[_RICE, _BLANKET], status="pending_review")

    assert await _persist_donation(couch, row) is True  # type: ignore[arg-type]
    doc = couch.put_doc.await_args.args[1]
    assert doc["status"] == "pending_review"
    assert [i["review_status"] for i in doc["items"]] == ["approved", "pending"]
    # CR-196: the keys the donor's edit form names lines by.
    assert [i["line_key"] for i in doc["items"]] == [
        _RICE["line_key"],
        _BLANKET["line_key"],
    ]


@pytest.mark.asyncio
async def test_an_auto_approved_booking_gets_a_system_audit():
    """CR-174 FR-26 / AC-12."""
    couch = _couch()
    row = _buffer_row(
        id="donation:01TESTDONATION0000000003",
        items_declared=[_BLANKET, _RICE],
        status="pending_review",
    )

    assert await _persist_donation(couch, row) is True  # type: ignore[arg-type]

    database, docs = couch.bulk_docs.await_args.args
    assert database == "shelter_sh001"
    (audit,) = docs
    assert audit["_id"] == campaign_auto_approve_audit_id(
        "donation:01TESTDONATION0000000003"
    )
    assert audit["type"] == "audit"
    assert audit["schema_v"] == 1
    assert audit["action"] == "manual_adjust"
    assert audit["target_type"] == "donation"
    assert audit["target_id"] == "donation:01TESTDONATION0000000003"
    assert audit["created_by"] == "system"
    assert audit["shelter_code"] == "SH001"
    assert audit["context"]["approved_by"] == "system"
    assert audit["context"]["rule"] == "campaign_line"
    assert audit["context"]["lines"] == [1]
    assert audit["reason"]
    assert audit["occurred_at"] == audit["created_at"]


@pytest.mark.asyncio
async def test_no_audit_when_no_line_was_approved():
    couch = _couch()
    row = _buffer_row(items_declared=[_BLANKET])

    assert await _persist_donation(couch, row) is True  # type: ignore[arg-type]
    couch.bulk_docs.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_rerun_does_not_record_the_approval_twice():
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
    row = _buffer_row(items_declared=[_RICE], status="verifying")

    assert await _persist_donation(couch, row) is True  # type: ignore[arg-type]
    couch.put_doc.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_failed_donation_write_records_no_approval():
    """Review #783 M5 — an audit written ahead of a PUT that fails names lines the donor
    may still change; the next poll's copy then hits the fixed id and is dropped."""
    couch = _couch()
    couch.put_doc = AsyncMock(side_effect=RuntimeError("couch down"))
    row = _buffer_row(items_declared=[_RICE], status="verifying")

    assert await _persist_donation(couch, row) is False  # type: ignore[arg-type]
    couch.bulk_docs.assert_not_awaited()
    assert row.synced_to_couch is False


@pytest.mark.asyncio
async def test_a_failed_audit_is_logged_and_the_donation_still_lands(caplog):
    """Once the donation is in CouchDB a re-run cannot PUT it again, so holding the row
    back would strand it; the lost audit is logged instead."""
    couch = _couch(bulk_rows=[{"id": "audit:x", "error": "forbidden", "reason": "no"}])
    row = _buffer_row(items_declared=[_RICE], status="verifying")

    assert await _persist_donation(couch, row) is True  # type: ignore[arg-type]
    couch.put_doc.assert_awaited_once()
    assert row.synced_to_couch is True
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
