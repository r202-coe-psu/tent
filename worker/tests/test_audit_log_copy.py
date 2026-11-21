from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from worker.audit_log import (
    AUDIT_LOG_DB,
    AuditCopy,
    AuditCopyIncomplete,
    copy_all_audit_docs,
    copy_audit_doc,
    to_audit_event,
)
from worker.couch.bootstrap import bootstrap_database
from worker.couch.processor import process_change

NOW = datetime(2026, 11, 17, 3, 4, 5, 678000, tzinfo=UTC)
STAMP = "2026-11-17T03:04:05.678Z"
ULID = "01JTESTAUDIT0000000000000A"


def _audit(**overrides) -> dict:
    doc = {
        "_id": f"audit:{ULID}",
        "_rev": "1-abc",
        "type": "audit",
        "schema_v": 1,
        "shelter_code": "SH001",
        "action": "duplicate_override",
        "target_type": "evacuee",
        "target_id": "evacuee:01X",
        "reason": "same person, different id card",
        "context": {"matched": ["evacuee:01Y"], "phone": "0812345678"},
        "occurred_at": "2026-11-16T10:00:00.000Z",
        "created_at": "2026-11-16T10:00:01.000Z",
        "updated_at": "2026-11-16T10:00:01.000Z",
        "created_by": "staff.a",
    }
    doc.update(overrides)
    return doc


def _http_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("PUT", f"http://couch/{AUDIT_LOG_DB}/x")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError("error", request=request, response=response)


def test_maps_a_named_action_to_an_audit_event():
    event = to_audit_event(_audit(), "shelter_sh001", NOW)

    assert event == {
        "_id": f"audit_event:{ULID}",
        "type": "audit_event",
        "schema_v": 1,
        "occurred_at": "2026-11-16T10:00:00.000Z",
        "created_at": STAMP,
        "updated_at": STAMP,
        "created_by": "staff.a",
        "actor": {"name": "staff.a", "kind": "user"},
        "action": "other",
        "event": "audit.duplicate_override",
        "entity": {"type": "evacuee", "id": "evacuee:01X", "label": None},
        "shelter_code": "SH001",
        "reason": "same person, different id card",
        "source": "worker_copy",
        "source_ref": f"audit:{ULID}",
    }


def test_action_other_uses_the_reason_as_event():
    event = to_audit_event(
        _audit(action="other", reason="role_grant.issued"), "shelter_sh001", NOW
    )

    assert event is not None
    assert event["event"] == "role_grant.issued"
    assert event["action"] == "other"
    assert event["reason"] == "role_grant.issued"


def test_worker_author_is_a_worker_actor():
    event = to_audit_event(_audit(created_by="worker"), "shelter_sh001", NOW)

    assert event is not None
    assert event["actor"] == {"name": "worker", "kind": "worker"}
    assert event["created_by"] == "worker"


def test_context_and_envelope_extras_are_not_copied():
    event = to_audit_event(_audit(), "shelter_sh001", NOW)

    assert event is not None
    assert "context" not in event
    assert "_rev" not in event
    assert "changes" not in event


def test_falls_back_to_created_at_and_the_database_shelter_code():
    source = _audit(occurred_at=None, shelter_code=None, reason="")

    event = to_audit_event(source, "shelter_sh042", NOW)

    assert event is not None
    assert event["occurred_at"] == "2026-11-16T10:00:01.000Z"
    assert event["shelter_code"] == "SH042"
    assert event["reason"] is None


def test_event_id_is_stable_across_copies():
    first = to_audit_event(_audit(), "shelter_sh001", NOW)
    second = to_audit_event(_audit(), "shelter_sh001", datetime.now(UTC))

    assert first is not None and second is not None
    assert first["_id"] == second["_id"] == f"audit_event:{ULID}"


@pytest.mark.parametrize("missing", ["action", "target_type", "target_id"])
def test_a_doc_missing_a_required_field_is_not_mapped(missing):
    source = _audit()
    source[missing] = None
    assert to_audit_event(source, "shelter_sh001", NOW) is None


def test_a_blank_required_field_is_not_mapped():
    assert to_audit_event(_audit(target_id="   "), "shelter_sh001", NOW) is None


def test_non_audit_id_is_not_mapped():
    assert to_audit_event(_audit(_id="evacuee:01X"), "shelter_sh001", NOW) is None


async def test_copy_puts_without_overwriting():
    couch = AsyncMock()

    assert (
        await copy_audit_doc(couch, _audit(), "shelter_sh001", now=NOW)
        is AuditCopy.COPIED
    )

    couch.put_doc.assert_awaited_once()
    database, doc = couch.put_doc.await_args.args
    assert database == AUDIT_LOG_DB
    assert doc["_id"] == f"audit_event:{ULID}"
    assert "_rev" not in doc
    assert couch.put_doc.await_args.kwargs == {"retry_conflict": False}


async def test_conflict_means_already_copied():
    couch = AsyncMock()
    couch.put_doc.side_effect = _http_error(409)

    assert (
        await copy_audit_doc(couch, _audit(), "shelter_sh001", now=NOW)
        is AuditCopy.COPIED
    )
    couch.put_doc.assert_awaited_once()


async def test_missing_audit_log_database_does_not_raise(caplog):
    couch = AsyncMock()
    couch.put_doc.side_effect = _http_error(404)

    assert (
        await copy_audit_doc(couch, _audit(), "shelter_sh001", now=NOW)
        is AuditCopy.SKIPPED
    )
    assert "rejected audit doc" in caplog.text
    couch.ensure_database.assert_not_awaited()


@pytest.mark.parametrize("status", [400, 403, 404, 422])
async def test_a_permanent_rejection_is_skipped_not_retried(status):
    couch = AsyncMock()
    couch.put_doc.side_effect = _http_error(status)

    assert (
        await copy_audit_doc(couch, _audit(), "shelter_sh001", now=NOW)
        is AuditCopy.SKIPPED
    )


@pytest.mark.parametrize(
    "error",
    [
        _http_error(500),
        _http_error(408),
        _http_error(429),
        httpx.ConnectError("down"),
        RuntimeError("boom"),
    ],
)
async def test_other_write_failures_ask_for_a_retry(error):
    couch = AsyncMock()
    couch.put_doc.side_effect = error

    assert (
        await copy_audit_doc(couch, _audit(), "shelter_sh001", now=NOW)
        is AuditCopy.RETRY
    )


def _change(seq: int, doc: dict | None = None, *, deleted: bool = False) -> dict:
    change: dict = {"seq": seq, "id": (doc or {}).get("_id", f"audit:{ULID}")}
    if doc is not None:
        change["doc"] = doc
    if deleted:
        change["deleted"] = True
    return change


@pytest.mark.parametrize("status", ["open", "closed"])
async def test_processor_copies_audit_changes(status):
    couch = AsyncMock()
    source = _audit()

    with (
        patch(
            "worker.couch.processor.projected_shelter_status",
            new_callable=AsyncMock,
            return_value=status,
        ),
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch("worker.couch.processor.copy_audit_doc", new_callable=AsyncMock) as copy,
        patch(
            "worker.couch.processor.apply_person", new_callable=AsyncMock
        ) as apply_person,
    ):
        await process_change(couch, "shelter_sh001", _change(7, source))

    copy.assert_awaited_once_with(couch, source, "shelter_sh001")
    apply_person.assert_not_awaited()
    save_cp.assert_awaited_once_with("shelter_sh001", 7)


@pytest.mark.parametrize("status", [None, "unknown"])
async def test_processor_skips_audit_of_cancelled_and_external_shelters(status):
    couch = AsyncMock()

    with (
        patch(
            "worker.couch.processor.projected_shelter_status",
            new_callable=AsyncMock,
            return_value=status,
        ),
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch("worker.couch.processor.copy_audit_doc", new_callable=AsyncMock) as copy,
    ):
        await process_change(couch, "shelter_sh001", _change(8, _audit()))

    copy.assert_not_awaited()
    save_cp.assert_awaited_once_with("shelter_sh001", 8)


async def test_processor_holds_the_checkpoint_when_the_copy_can_be_retried():
    couch = AsyncMock()
    couch.put_doc.side_effect = _http_error(503)

    with (
        patch(
            "worker.couch.processor.projected_shelter_status",
            new_callable=AsyncMock,
            return_value="open",
        ),
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        pytest.raises(AuditCopyIncomplete),
    ):
        await process_change(couch, "shelter_sh001", _change(9, _audit()))

    couch.put_doc.assert_awaited_once()
    save_cp.assert_not_awaited()


async def test_processor_checkpoints_past_an_audit_doc_it_can_never_copy():
    couch = AsyncMock()
    couch.put_doc.side_effect = _http_error(404)

    with (
        patch(
            "worker.couch.processor.projected_shelter_status",
            new_callable=AsyncMock,
            return_value="open",
        ),
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
    ):
        await process_change(couch, "shelter_sh001", _change(9, _audit()))

    save_cp.assert_awaited_once_with("shelter_sh001", 9)


async def test_processor_ignores_deleted_audit_and_other_types():
    couch = AsyncMock()

    with (
        patch(
            "worker.couch.processor.projected_shelter_status",
            new_callable=AsyncMock,
            return_value="open",
        ),
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.apply_person", new_callable=AsyncMock),
        patch("worker.couch.processor.copy_audit_doc", new_callable=AsyncMock) as copy,
    ):
        await process_change(couch, "shelter_sh001", _change(10, deleted=True))
        await process_change(
            couch,
            "shelter_sh001",
            _change(11, {"_id": "household:01", "type": "household"}),
        )

    copy.assert_not_awaited()


async def test_processor_does_not_copy_from_the_registry():
    couch = AsyncMock()

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.processor.copy_audit_doc", new_callable=AsyncMock) as copy,
    ):
        await process_change(couch, "registry", _change(12, _audit()))

    copy.assert_not_awaited()


def _couch(docs):
    async def iter_all_docs(_database):
        for doc in docs:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs
    couch.db_update_seq = AsyncMock(return_value="42-abc")
    return couch


def _bootstrap_patches():
    return (
        patch("worker.couch.bootstrap.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.bootstrap.apply_person", new_callable=AsyncMock),
        patch("worker.couch.bootstrap.sync_booking_stay", new_callable=AsyncMock),
        patch(
            "worker.couch.bootstrap.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch("worker.couch.bootstrap.refresh_on_hand", new_callable=AsyncMock),
        patch("worker.couch.bootstrap.refresh_occupancy", new_callable=AsyncMock),
        patch("worker.couch.bootstrap.refresh_shelter_stock", new_callable=AsyncMock),
        patch(
            "worker.couch.bootstrap.refresh_shelter_occupants", new_callable=AsyncMock
        ),
        patch("worker.quota.settle.settle_shelved_quota", new_callable=AsyncMock),
    )


@pytest.mark.parametrize("persons_only", [False, True])
async def test_bootstrap_copies_existing_audit_docs(persons_only):
    first = _audit()
    second = _audit(_id="audit:01JTESTAUDIT0000000000000B", action="other")
    couch = _couch([first, {"_id": "household:01", "type": "household"}, second])

    patches = _bootstrap_patches()
    with (
        patches[0],
        patches[1],
        patches[2],
        patches[3],
        patches[4],
        patches[5],
        patches[6],
        patches[7],
        patches[8],
        patch("worker.couch.bootstrap.copy_audit_doc", new_callable=AsyncMock) as copy,
    ):
        await bootstrap_database(couch, "shelter_sh001", persons_only=persons_only)

    assert [c.args for c in copy.await_args_list] == [
        (couch, first, "shelter_sh001"),
        (couch, second, "shelter_sh001"),
    ]


async def test_audit_only_scan_copies_every_audit_doc():
    first = _audit()
    second = _audit(_id="audit:01JTESTAUDIT0000000000000B")
    couch = _couch([first, {"_id": "evacuee:01", "type": "evacuee"}, second])
    ok = MagicMock()
    couch.put_doc.side_effect = [ok, _http_error(409)]

    copied = await copy_all_audit_docs(couch, "shelter_sh004")

    assert copied == 2
    ids = [c.args[1]["_id"] for c in couch.put_doc.await_args_list]
    assert ids == [
        f"audit_event:{ULID}",
        "audit_event:01JTESTAUDIT0000000000000B",
    ]


async def test_audit_only_scan_does_not_count_a_doc_it_skipped():
    couch = _couch([_audit()])
    couch.put_doc.side_effect = _http_error(403)

    assert await copy_all_audit_docs(couch, "shelter_sh004") == 0


async def test_audit_only_scan_raises_when_a_doc_still_needs_a_retry():
    couch = _couch([_audit()])
    couch.put_doc.side_effect = _http_error(503)

    with pytest.raises(AuditCopyIncomplete):
        await copy_all_audit_docs(couch, "shelter_sh004")
