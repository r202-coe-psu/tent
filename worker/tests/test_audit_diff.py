from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from worker.audit_diff import (
    AuditDiffConfig,
    audit_diff,
    audit_event_id,
    build_audit_diff_event,
    canonical,
    compute_changes,
    resolve_actor,
)
from worker.audit_log import AUDIT_LOG_DB
from worker.config import load_settings
from worker.couch.bootstrap import bootstrap_database
from worker.couch.client import CouchClient
from worker.couch.processor import process_change
from worker.listeners.registry import ListenerManager

NOW = datetime(2026, 11, 18, 1, 2, 3, 456000, tzinfo=UTC)
STAMP = "2026-11-18T01:02:03.456Z"
PUBLIC_WRITER = "public_writer"


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(
        "worker.audit_diff._config",
        AuditDiffConfig(enabled=True, public_writer=PUBLIC_WRITER),
    )


def _http_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("PUT", f"http://couch/{AUDIT_LOG_DB}/x")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError("error", request=request, response=response)


def _item(**overrides) -> dict:
    doc = {
        "_id": "item_master:01ITEM",
        "_rev": "2-bbb",
        "type": "item_master",
        "schema_v": 2,
        "name": "Rice 5kg",
        "sku": "RICE-5",
        "deactivated": False,
        "created_at": "2026-11-17T00:00:00.000Z",
        "updated_at": "2026-11-18T00:00:00.000Z",
        "created_by": "creator",
        "updated_by": "staff.a",
    }
    doc.update(overrides)
    return doc


def _evacuee(**overrides) -> dict:
    doc = {
        "_id": "evacuee:01EVAC",
        "_rev": "2-bbb",
        "type": "evacuee",
        "schema_v": 3,
        "first_name": "Somchai",
        "phone": "0812345678",
        "household_id": "household:01",
        "created_at": "2026-11-17T00:00:00.000Z",
        "updated_at": "2026-11-18T00:00:00.000Z",
        "created_by": "creator",
        "updated_by": "staff.b",
    }
    doc.update(overrides)
    return doc


def _change(doc: dict, *, seq: int = 1, deleted: bool = False) -> dict:
    change = {
        "seq": seq,
        "id": doc["_id"],
        "changes": [{"rev": doc["_rev"]}],
        "doc": doc,
    }
    if deleted:
        change["deleted"] = True
    return change


def _couch(previous: dict | None = None, *, ids: list[str] | None = None) -> AsyncMock:
    couch = AsyncMock()

    async def get_doc_rev(_database, _doc_id, rev, *, revs=False):
        if revs:
            start = int(rev.split("-", 1)[0])
            return {
                "_id": _doc_id,
                "_rev": rev,
                "_revisions": {
                    "start": start,
                    "ids": ids
                    if ids is not None
                    else [rev.split("-", 1)[1], "aaa"][: max(start, 1)],
                },
            }
        if previous is None:
            return None
        assert rev == previous["_rev"]
        return previous

    couch.get_doc_rev = AsyncMock(side_effect=get_doc_rev)
    return couch


async def _build(couch, database: str, change: dict) -> dict | None:
    return await build_audit_diff_event(
        couch, database, change, public_writer=PUBLIC_WRITER, now=NOW
    )


async def test_create_on_first_rev():
    doc = _item(_rev="1-aaa", updated_by="staff.a")
    couch = _couch()

    event = await _build(couch, "catalog", _change(doc))

    assert event == {
        "_id": audit_event_id("catalog", "item_master:01ITEM", "1-aaa"),
        "type": "audit_event",
        "schema_v": 1,
        "occurred_at": "2026-11-18T00:00:00.000Z",
        "created_at": STAMP,
        "updated_at": STAMP,
        "created_by": "staff.a",
        "actor": {"name": "staff.a", "kind": "user"},
        "action": "create",
        "event": "item_master.created",
        "entity": {
            "type": "item_master",
            "id": "item_master:01ITEM",
            "label": "Rice 5kg",
        },
        "shelter_code": None,
        "reason": None,
        "source": "worker_diff",
        "source_ref": "item_master:01ITEM",
    }
    couch.get_doc_rev.assert_not_awaited()


async def test_update_records_allowlisted_values():
    previous = _item(_rev="1-aaa", name="Rice", updated_at="2026-11-17T00:00:00.000Z")
    couch = _couch(previous)

    event = await _build(couch, "catalog", _change(_item()))

    assert event is not None
    assert event["action"] == "update"
    assert event["event"] == "item_master.updated"
    assert event["changes"] == [{"field": "name", "from": "Rice", "to": "Rice 5kg"}]
    assert "changes_unknown" not in event
    assert couch.get_doc_rev.await_args_list[0].args == (
        "catalog",
        "item_master:01ITEM",
        "2-bbb",
    )
    assert couch.get_doc_rev.await_args_list[0].kwargs == {"revs": True}
    assert couch.get_doc_rev.await_args_list[1].args == (
        "catalog",
        "item_master:01ITEM",
        "1-aaa",
    )


async def test_status_field_change_is_a_status_change():
    previous = _item(_rev="1-aaa")
    couch = _couch(previous)

    event = await _build(couch, "catalog", _change(_item(deactivated=True)))

    assert event is not None
    assert event["action"] == "status_change"
    assert event["event"] == "item_master.status_changed"
    assert event["changes"] == [{"field": "deactivated", "from": False, "to": True}]


async def test_household_status_change():
    previous = {
        "_id": "household:01",
        "_rev": "1-aaa",
        "type": "household",
        "status": "active",
        "head_name": "Somchai",
    }
    doc = {**previous, "_rev": "2-bbb", "status": "departed", "updated_by": "staff.a"}
    couch = _couch(previous)

    event = await _build(couch, "shelter_sh001", _change(doc))

    assert event is not None
    assert event["event"] == "household.status_changed"
    assert event["entity"] == {"type": "household", "id": "household:01", "label": None}
    assert event["changes"] == [{"field": "status", "from": "active", "to": "departed"}]


async def test_delete_uses_tombstone_actor_and_previous_label():
    previous = {
        "_id": "recipe:01",
        "_rev": "1-aaa",
        "type": "recipe",
        "label": "Rice soup",
    }
    tombstone = {
        "_id": "recipe:01",
        "_rev": "2-bbb",
        "_deleted": True,
        "updated_by": "staff.c",
        "updated_at": "2026-11-18T00:30:00.000Z",
    }
    couch = _couch(previous)

    event = await _build(couch, "shelter_sh002", _change(tombstone, deleted=True))

    assert event is not None
    assert event["action"] == "delete"
    assert event["event"] == "recipe.deleted"
    assert event["actor"] == {"name": "staff.c", "kind": "user"}
    assert event["entity"] == {
        "type": "recipe",
        "id": "recipe:01",
        "label": "Rice soup",
    }
    assert event["occurred_at"] == "2026-11-18T00:30:00.000Z"
    assert event["shelter_code"] == "SH002"
    assert "changes" not in event
    assert "changes_unknown" not in event


async def test_delete_without_readable_previous_still_emits():
    tombstone = {"_id": "recipe:01", "_rev": "2-bbb", "_deleted": True}
    couch = _couch(None)

    event = await _build(couch, "shelter_sh002", _change(tombstone, deleted=True))

    assert event is not None
    assert event["event"] == "recipe.deleted"
    assert event["actor"] == {"name": "unknown", "kind": "unknown"}
    assert event["entity"]["label"] is None
    assert event["occurred_at"] == STAMP


async def test_event_id_is_deterministic_sha256():
    expected = hashlib.sha256(b"shelter_sh001|evacuee:01EVAC|2-bbb").hexdigest()

    assert audit_event_id("shelter_sh001", "evacuee:01EVAC", "2-bbb") == (
        f"audit_event:rev:{expected}"
    )
    first = await _build(
        _couch(_evacuee(_rev="1-aaa")), "shelter_sh001", _change(_evacuee())
    )
    second = await _build(
        _couch(_evacuee(_rev="1-aaa")), "shelter_sh001", _change(_evacuee())
    )
    assert first is not None and second is not None
    assert first["_id"] == second["_id"] == f"audit_event:rev:{expected}"


async def test_evacuee_phone_is_field_only_and_label_is_null():
    previous = _evacuee(_rev="1-aaa", phone="0899999999")
    couch = _couch(previous)

    event = await _build(couch, "shelter_sh001", _change(_evacuee()))

    assert event is not None
    assert event["changes"] == [{"field": "phone"}]
    assert event["entity"]["label"] is None


async def test_evacuee_allowlisted_field_keeps_values():
    previous = _evacuee(_rev="1-aaa", household_id="household:00")
    couch = _couch(previous)

    event = await _build(couch, "shelter_sh001", _change(_evacuee()))

    assert event is not None
    assert event["changes"] == [
        {"field": "household_id", "from": "household:00", "to": "household:01"}
    ]


def test_medical_is_always_field_only():
    assert compute_changes(
        "medical", {"condition": "a", "notes": "x"}, {"condition": "b", "notes": "x"}
    ) == [{"field": "condition"}]


def test_non_scalar_allowlisted_value_is_field_only():
    assert compute_changes("item_master", {"name": "a"}, {"name": {"th": "b"}}) == [
        {"field": "name"}
    ]


def test_string_array_value_is_kept():
    assert compute_changes("item_master", {}, {"merged_into": ["x", "y"]}) == [
        {"field": "merged_into", "from": None, "to": ["x", "y"]}
    ]


def test_canonical_compare_ignores_key_order():
    before = {"meta": {"a": 1, "b": [1, {"x": 1, "y": 2}]}}
    after = {"meta": {"b": [1, {"y": 2, "x": 1}], "a": 1}}

    assert compute_changes("item_master", before, after) == []
    assert canonical(1.0) == canonical(1)
    assert canonical(None) == "null"


def test_envelope_fields_are_ignored():
    before = _item(_rev="1-aaa")
    after = _item(
        _rev="2-bbb",
        updated_at="2026-11-19T00:00:00.000Z",
        updated_by="someone",
        created_by="x",
        created_at="y",
        schema_v=9,
    )

    assert compute_changes("item_master", before, after) == []


def test_changes_are_sorted_by_field():
    changes = compute_changes(
        "item_master",
        {"sku": "a", "name": "a", "zz": 1},
        {"sku": "b", "name": "b", "zz": 2},
    )

    assert [c["field"] for c in changes] == ["name", "sku", "zz"]


async def test_unreadable_previous_rev_sets_changes_unknown():
    couch = _couch(None)

    event = await _build(couch, "catalog", _change(_item()))

    assert event is not None
    assert event["action"] == "update"
    assert event["changes_unknown"] is True
    assert "changes" not in event


async def test_previous_rev_read_error_sets_changes_unknown():
    couch = AsyncMock()
    couch.get_doc_rev = AsyncMock(side_effect=httpx.ConnectError("down"))

    event = await _build(couch, "catalog", _change(_item()))

    assert event is not None
    assert event["changes_unknown"] is True


async def test_missing_revision_history_sets_changes_unknown():
    couch = _couch(_item(_rev="1-aaa"), ids=["bbb"])

    event = await _build(couch, "catalog", _change(_item()))

    assert event is not None
    assert event["changes_unknown"] is True


@pytest.mark.parametrize(
    ("updated_by", "expected"),
    [
        ("worker", {"name": "worker", "kind": "worker"}),
        ("kiosk:dev-01", {"name": "kiosk:dev-01", "kind": "system"}),
        ("system:seed", {"name": "system:seed", "kind": "system"}),
        (PUBLIC_WRITER, {"name": "public", "kind": "system"}),
        ("staff.a", {"name": "staff.a", "kind": "user"}),
        (None, {"name": "unknown", "kind": "unknown"}),
        ("", {"name": "unknown", "kind": "unknown"}),
    ],
)
def test_actor_mapping(updated_by, expected):
    doc = {"updated_by": updated_by, "created_by": "creator"}

    assert resolve_actor(doc, first_rev=False, public_writer=PUBLIC_WRITER) == expected


def test_first_rev_falls_back_to_created_by():
    assert resolve_actor(
        {"created_by": "creator"}, first_rev=True, public_writer=PUBLIC_WRITER
    ) == {"name": "creator", "kind": "user"}
    assert resolve_actor(
        {"created_by": "creator", "updated_by": "editor"},
        first_rev=True,
        public_writer=PUBLIC_WRITER,
    ) == {"name": "editor", "kind": "user"}


async def test_event_created_by_is_actor_name():
    doc = _item(_rev="1-aaa", updated_by=PUBLIC_WRITER)

    event = await _build(_couch(), "catalog", _change(doc))

    assert event is not None
    assert event["created_by"] == "public"
    assert event["actor"] == {"name": "public", "kind": "system"}


@pytest.mark.parametrize(
    ("doc", "label"),
    [
        ({"_id": "item_category:1", "type": "item_category", "name": "Food"}, "Food"),
        ({"_id": "recipe:1", "type": "recipe", "label": "Soup"}, "Soup"),
        (
            {"_id": "unit_of_measure:kg", "type": "unit_of_measure", "label_th": "กก."},
            "กก.",
        ),
        (
            {"_id": "requirement_group:1", "type": "requirement_group", "name": "G"},
            None,
        ),
        ({"_id": "household:1", "type": "household", "name": "Family"}, None),
        ({"_id": "medical:1", "type": "medical", "name": "X"}, None),
    ],
)
async def test_labels(doc, label):
    event = await _build(_couch(), "shelter_sh001", _change({**doc, "_rev": "1-a"}))

    assert event is not None
    assert event["entity"]["label"] == label


async def test_shelter_code_from_db_name_over_doc():
    doc = _item(_rev="1-aaa", shelter_code="OTHER")

    event = await _build(_couch(), "shelter_sh009", _change(doc))

    assert event is not None
    assert event["shelter_code"] == "SH009"


async def test_catalog_shelter_code_from_doc_or_null():
    scoped = await _build(
        _couch(), "catalog", _change(_item(_rev="1-aaa", shelter_code="SH003"))
    )
    central = await _build(_couch(), "catalog", _change(_item(_rev="1-aaa")))

    assert scoped is not None and central is not None
    assert scoped["shelter_code"] == "SH003"
    assert central["shelter_code"] is None


async def test_catalog_delete_takes_shelter_code_from_previous_rev():
    previous = _item(_rev="1-aaa", shelter_code="SH003")
    tombstone = {"_id": "item_master:01ITEM", "_rev": "2-bbb", "_deleted": True}

    event = await _build(_couch(previous), "catalog", _change(tombstone, deleted=True))

    assert event is not None
    assert event["shelter_code"] == "SH003"
    assert event["entity"]["label"] == "Rice 5kg"


@pytest.mark.parametrize(
    "doc",
    [
        {"_id": "stock_ledger:1", "_rev": "1-a", "type": "stock_ledger"},
        {"_id": "audit:01X", "_rev": "1-a", "type": "audit"},
        {"_id": "lot_counter:1", "_rev": "2-a", "type": "lot_counter"},
        {"_id": "_design/access", "_rev": "3-a"},
    ],
)
async def test_non_audited_type_emits_nothing(doc):
    assert await _build(_couch(), "shelter_sh001", _change(doc)) is None


async def test_tombstone_type_comes_from_id_prefix():
    tombstone = {"_id": "stock_ledger:1", "_rev": "2-a", "_deleted": True}

    assert (
        await _build(_couch(), "shelter_sh001", _change(tombstone, deleted=True))
    ) is None


async def test_audit_diff_writes_without_overwriting(enabled):
    couch = _couch(_item(_rev="1-aaa", name="Rice"))

    assert await audit_diff(couch, "catalog", _change(_item()), now=NOW) is True

    couch.put_doc.assert_awaited_once()
    database, event = couch.put_doc.await_args.args
    assert database == AUDIT_LOG_DB
    assert event["_id"].startswith("audit_event:rev:")
    assert couch.put_doc.await_args.kwargs == {"retry_conflict": False}


async def test_conflict_means_already_written(enabled):
    couch = _couch()
    couch.put_doc.side_effect = _http_error(409)

    doc = _item(_rev="1-aaa")
    assert await audit_diff(couch, "catalog", _change(doc), now=NOW) is True


async def test_missing_audit_log_database_is_a_warning(enabled, caplog):
    couch = _couch()
    couch.put_doc.side_effect = _http_error(404)

    doc = _item(_rev="1-aaa")
    assert await audit_diff(couch, "catalog", _change(doc), now=NOW) is False
    assert "does not exist" in caplog.text


@pytest.mark.parametrize(
    "error", [_http_error(500), httpx.ConnectError("down"), RuntimeError("boom")]
)
async def test_other_write_failures_do_not_raise(enabled, error):
    couch = _couch()
    couch.put_doc.side_effect = error

    doc = _item(_rev="1-aaa")
    assert await audit_diff(couch, "catalog", _change(doc), now=NOW) is False


async def test_flag_off_emits_nothing():
    couch = _couch()

    doc = _item(_rev="1-aaa")
    assert await audit_diff(couch, "catalog", _change(doc), now=NOW) is False
    couch.put_doc.assert_not_awaited()


async def test_other_databases_emit_nothing(enabled):
    couch = _couch()

    doc = _item(_rev="1-aaa")
    assert await audit_diff(couch, "registry", _change(doc), now=NOW) is False
    couch.put_doc.assert_not_awaited()


async def test_processor_emits_for_shelter_and_keeps_projecting(enabled):
    couch = _couch()
    couch.get_doc = AsyncMock(return_value=None)
    couch.put_doc.side_effect = _http_error(500)
    doc = _evacuee(_rev="1-aaa")

    with (
        patch(
            "worker.couch.processor.projected_shelter_status",
            new_callable=AsyncMock,
            return_value="open",
        ),
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch(
            "worker.couch.processor.apply_person", new_callable=AsyncMock
        ) as apply_person,
        patch("worker.couch.processor.sync_booking_stay", new_callable=AsyncMock),
        patch("worker.couch.processor.refresh_occupancy", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.refresh_shelter_occupants", new_callable=AsyncMock
        ),
    ):
        await process_change(couch, "shelter_sh001", _change(doc, seq=5))

    couch.put_doc.assert_awaited_once()
    assert couch.put_doc.await_args.args[0] == AUDIT_LOG_DB
    apply_person.assert_awaited_once()
    save_cp.assert_awaited_once_with("shelter_sh001", 5)


async def test_processor_flag_off_emits_nothing():
    couch = _couch()
    doc = {"_id": "household:01", "_rev": "1-a", "type": "household"}

    with (
        patch(
            "worker.couch.processor.projected_shelter_status",
            new_callable=AsyncMock,
            return_value="open",
        ),
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
    ):
        await process_change(couch, "shelter_sh001", _change(doc))

    couch.put_doc.assert_not_awaited()


async def test_processor_catalog_only_audits(enabled):
    couch = _couch()
    doc = _item(_rev="1-aaa")

    with (
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch(
            "worker.couch.processor.projected_shelter_status", new_callable=AsyncMock
        ) as status,
    ):
        await process_change(couch, "catalog", _change(doc, seq=9))

    couch.put_doc.assert_awaited_once()
    status.assert_not_awaited()
    save_cp.assert_awaited_once_with("catalog", 9)


async def test_bootstrap_does_not_emit(enabled):
    docs = [_item(_rev="3-c"), _evacuee(_rev="1-a")]

    async def iter_all_docs(_database):
        for doc in docs:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs
    couch.db_update_seq = AsyncMock(return_value="42-abc")

    with (
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
    ):
        await bootstrap_database(couch, "shelter_sh001")

    couch.put_doc.assert_not_awaited()
    couch.get_doc_rev.assert_not_awaited()


async def test_catalog_listener_starts_at_current_seq_when_enabled(enabled):
    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.db_update_seq = AsyncMock(return_value="77-x")
    manager = ListenerManager(couch)
    manager.ensure_listener = AsyncMock()
    manager.sync_shelter_listeners = AsyncMock()

    with (
        patch(
            "worker.listeners.registry.get_checkpoint",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "worker.listeners.registry.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch("worker.listeners.registry.asyncio.create_task") as create_task,
    ):
        await manager.start()
    create_task.call_args.args[0].close()

    save_cp.assert_awaited_once_with("catalog", "77-x")
    started = [c.args[0] for c in manager.ensure_listener.await_args_list]
    assert started == ["registry", "catalog"]


async def test_catalog_listener_keeps_existing_checkpoint(enabled):
    couch = AsyncMock()
    manager = ListenerManager(couch)
    manager.ensure_listener = AsyncMock()

    with (
        patch(
            "worker.listeners.registry.get_checkpoint",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ),
        patch(
            "worker.listeners.registry.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
    ):
        await manager.start_catalog_listener()

    save_cp.assert_not_awaited()
    manager.ensure_listener.assert_awaited_once_with("catalog")


async def test_catalog_listener_not_started_when_disabled():
    manager = ListenerManager(AsyncMock())
    manager.ensure_listener = AsyncMock()
    manager.sync_shelter_listeners = AsyncMock()

    with patch("worker.listeners.registry.asyncio.create_task") as create_task:
        await manager.start()
    create_task.call_args.args[0].close()

    started = [c.args[0] for c in manager.ensure_listener.await_args_list]
    assert started == ["registry"]


async def test_shelter_sync_keeps_the_catalog_listener():
    manager = ListenerManager(AsyncMock())
    manager._tasks = {"catalog": MagicMock(), "shelter_sh001": MagicMock()}
    manager.stop_listener = AsyncMock()

    with patch(
        "worker.listeners.registry.list_listened_shelters",
        new_callable=AsyncMock,
        return_value={},
    ):
        await manager.sync_shelter_listeners()

    manager.stop_listener.assert_awaited_once_with("shelter_sh001")


def test_settings_read_flag_and_public_writer(monkeypatch):
    monkeypatch.delenv("COUCHDB_PUBLIC_WRITER_NAME", raising=False)
    monkeypatch.delenv("COUCHDB_PUBLIC_WRITER_USER", raising=False)
    monkeypatch.delenv("AUDIT_DIFF_ENABLED", raising=False)
    monkeypatch.delenv("COUCHDB_PUBLIC_WRITER_URL", raising=False)
    defaults = load_settings()
    assert defaults.audit_diff_enabled is False
    assert defaults.public_writer_name == "public_writer"

    monkeypatch.setenv("AUDIT_DIFF_ENABLED", "true")
    monkeypatch.setenv("COUCHDB_PUBLIC_WRITER_URL", "http://pw%2Bx:secret@couchdb:5984")
    settings = load_settings()
    assert settings.audit_diff_enabled is True
    assert settings.public_writer_name == "pw+x"

    monkeypatch.setenv("COUCHDB_PUBLIC_WRITER_NAME", "writer_explicit")
    assert load_settings().public_writer_name == "writer_explicit"


def _client() -> CouchClient:
    settings = MagicMock()
    settings.couch_base_url = "http://couch:5984"
    settings.couchdb_user = "admin"
    settings.couchdb_password = "password"
    return CouchClient(settings)


def _ok(method: str, body) -> httpx.Response:
    return httpx.Response(201, json=body, request=httpx.Request(method, "http://x"))


@pytest.mark.parametrize(
    ("database", "stamped"),
    [
        ("shelter_sh001", True),
        ("catalog", True),
        ("registry", False),
        ("audit_log", False),
        ("_users", False),
    ],
)
async def test_put_doc_stamps_worker_only_for_shelter_and_catalog(database, stamped):
    client = _client()
    client._client.put = AsyncMock(return_value=_ok("PUT", {"ok": True}))
    doc = {"_id": "x:1", "updated_by": "staff.a"}

    await client.put_doc(database, doc)

    sent = client._client.put.await_args.kwargs["json"]
    assert sent["updated_by"] == ("worker" if stamped else "staff.a")
    assert doc["updated_by"] == "staff.a"
    await client.close()


async def test_put_doc_conflict_retry_keeps_the_stamp():
    client = _client()
    conflict = httpx.Response(
        409, json={"error": "conflict"}, request=httpx.Request("PUT", "http://x")
    )
    client._client.put = AsyncMock(side_effect=[conflict, _ok("PUT", {"ok": True})])
    client.get_doc = AsyncMock(return_value={"_id": "x:1", "_rev": "1-a"})

    await client.put_doc("shelter_sh001", {"_id": "x:1"})

    retry = client._client.put.await_args_list[1].kwargs["json"]
    assert retry["updated_by"] == "worker"
    assert retry["_rev"] == "1-a"
    await client.close()


async def test_bulk_docs_stamps_rows_and_keeps_tombstones():
    client = _client()
    client._client.post = AsyncMock(return_value=_ok("POST", []))

    await client.bulk_docs(
        "catalog",
        [{"_id": "a:1"}, {"_id": "b:1", "_rev": "2-x", "_deleted": True}],
    )

    sent = client._client.post.await_args.kwargs["json"]["docs"]
    assert sent == [
        {"_id": "a:1", "updated_by": "worker"},
        {"_id": "b:1", "_rev": "2-x", "_deleted": True, "updated_by": "worker"},
    ]
    await client.close()


async def test_bulk_docs_leaves_other_databases_untouched():
    client = _client()
    client._client.post = AsyncMock(return_value=_ok("POST", []))

    await client.bulk_docs("registry", [{"_id": "a:1"}])

    assert client._client.post.await_args.kwargs["json"]["docs"] == [{"_id": "a:1"}]
    await client.close()


async def test_update_doc_stamps_shelter_writes():
    client = _client()
    client.get_doc = AsyncMock(return_value={"_id": "a:1", "_rev": "1-a"})
    client._client.put = AsyncMock(return_value=_ok("PUT", {"ok": True, "rev": "2-b"}))

    async def mutate(doc):
        return {**doc, "x": 1}

    written = await client.update_doc("shelter_sh001", "a:1", mutate)

    assert written is not None
    assert written["updated_by"] == "worker"
    assert client._client.put.await_args.kwargs["json"]["updated_by"] == "worker"
    await client.close()
