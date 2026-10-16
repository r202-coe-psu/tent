"""Auto re-bootstrap when PROJECTION_VERSION changes (stored version vs code)."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from worker.couch import bootstrap as bs
from worker.couch import checkpoint as cp
from worker.projection_version import PROJECTION_VERSION


class FakeStore:
    """In-memory stand-in for the registry checkpoint + stored projection version."""

    def __init__(self, *, checkpoint: bool, version: int | None) -> None:
        self.checkpoint = checkpoint
        self.version = version

    async def get_checkpoint(self, database: str):
        return SimpleNamespace(last_seq="1-a") if self.checkpoint else None

    async def get_projection_version(self) -> int | None:
        return self.version

    async def save_projection_version(self, version: int) -> None:
        self.version = version


@pytest.fixture
def make_store():
    patches = []

    def _make(*, checkpoint: bool = True, version: int | None = None) -> FakeStore:
        store = FakeStore(checkpoint=checkpoint, version=version)
        for name in (
            "get_checkpoint",
            "get_projection_version",
            "save_projection_version",
        ):
            p = patch.object(bs, name, getattr(store, name))
            p.start()
            patches.append(p)
        return store

    yield _make
    for p in patches:
        p.stop()


@pytest.fixture
def scan():
    """Replace the actual scan so tests only exercise the decision + version bookkeeping."""
    with (
        patch.object(bs, "bootstrap_database", new_callable=AsyncMock) as db,
        patch.object(
            bs,
            "list_open_shelter_codes",
            new_callable=AsyncMock,
            return_value=["SH001"],
        ),
    ):
        yield db


async def test_first_install_without_checkpoint_bootstraps_and_stores_version(
    make_store, scan
):
    store = make_store(checkpoint=False, version=None)

    assert await bs.needs_bootstrap() is True
    assert await bs.maybe_bootstrap(AsyncMock(), force=False) is True

    assert scan.await_count == 2  # registry + SH001
    assert store.version == PROJECTION_VERSION


async def test_existing_install_without_stored_version_bootstraps_once(
    make_store, scan
):
    store = make_store(checkpoint=True, version=None)

    assert await bs.maybe_bootstrap(AsyncMock(), force=False) is True
    assert store.version == PROJECTION_VERSION

    scan.reset_mock()
    assert await bs.maybe_bootstrap(AsyncMock(), force=False) is False
    scan.assert_not_awaited()


async def test_stored_equal_to_code_does_not_bootstrap(make_store, scan):
    store = make_store(version=PROJECTION_VERSION)

    assert await bs.needs_bootstrap() is False
    assert await bs.maybe_bootstrap(AsyncMock(), force=False) is False

    scan.assert_not_awaited()
    assert store.version == PROJECTION_VERSION


async def test_stored_lower_than_code_bootstraps_and_advances_version(make_store, scan):
    store = make_store(version=PROJECTION_VERSION - 1)

    assert await bs.maybe_bootstrap(AsyncMock(), force=False) is True

    assert scan.await_count == 2
    assert store.version == PROJECTION_VERSION


async def test_stored_higher_than_code_skips_bootstrap_and_warns(
    make_store, scan, caplog
):
    store = make_store(version=PROJECTION_VERSION + 5)

    with caplog.at_level(logging.WARNING, logger=bs.logger.name):
        assert await bs.maybe_bootstrap(AsyncMock(), force=False) is False

    scan.assert_not_awaited()
    assert store.version == PROJECTION_VERSION + 5  # rollback never lowers it
    assert any(
        r.levelno == logging.WARNING and "newer" in r.getMessage()
        for r in caplog.records
    )


async def test_failed_bootstrap_does_not_store_version(make_store, scan):
    store = make_store(version=PROJECTION_VERSION - 1)
    scan.side_effect = [None, RuntimeError("couch down")]  # registry ok, shelter fails

    with pytest.raises(RuntimeError):
        await bs.maybe_bootstrap(AsyncMock(), force=False)

    assert store.version == PROJECTION_VERSION - 1
    # next start retries
    scan.side_effect = None
    assert await bs.maybe_bootstrap(AsyncMock(), force=False) is True
    assert store.version == PROJECTION_VERSION


async def test_failed_first_install_leaves_version_unset(make_store, scan):
    store = make_store(checkpoint=False, version=None)
    scan.side_effect = RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await bs.maybe_bootstrap(AsyncMock(), force=False)

    assert store.version is None


async def test_forced_bootstrap_runs_even_when_current_and_stores_version(
    make_store, scan
):
    store = make_store(version=PROJECTION_VERSION)

    assert await bs.maybe_bootstrap(AsyncMock(), force=True) is True

    assert scan.await_count == 2
    assert store.version == PROJECTION_VERSION


async def test_forced_bootstrap_repairs_a_newer_stored_version(make_store, scan):
    store = make_store(version=PROJECTION_VERSION + 3)

    await bs.maybe_bootstrap(AsyncMock(), force=True)

    assert store.version == PROJECTION_VERSION


async def test_bootstrap_only_flag_path_stores_version(make_store, scan):
    """main.run(bootstrap_only=True) forces the scan, stores the version, then exits."""
    from worker import main as worker_main

    store = make_store(checkpoint=True, version=None)
    couch = AsyncMock()
    with (
        patch.object(worker_main, "load_settings"),
        patch.object(worker_main, "init_db", new_callable=AsyncMock),
        patch.object(worker_main, "close_db", new_callable=AsyncMock),
        patch.object(worker_main, "CouchClient", return_value=couch),
        patch.object(
            worker_main, "ListenerManager", return_value=AsyncMock()
        ) as manager,
    ):
        await worker_main.run(force_bootstrap=False, bootstrap_only=True)

    assert store.version == PROJECTION_VERSION
    manager.return_value.start.assert_not_called()


async def test_bootstrap_reason_messages(make_store, caplog):
    make_store(checkpoint=False)
    assert "first install" in (await bs.bootstrap_reason() or "")

    make_store(checkpoint=True, version=None)
    assert "not recorded" in (await bs.bootstrap_reason() or "")

    make_store(checkpoint=True, version=PROJECTION_VERSION - 1)
    reason = await bs.bootstrap_reason() or ""
    assert f"v{PROJECTION_VERSION - 1} to v{PROJECTION_VERSION}" in reason


class _FakeCollection:
    def __init__(self) -> None:
        self.docs: dict[str, dict] = {}

    async def find_one(self, query):
        return self.docs.get(query["_id"])

    async def replace_one(self, query, doc, upsert=False):
        assert upsert
        self.docs[query["_id"]] = doc


async def test_projection_version_store_round_trip():
    coll = _FakeCollection()
    with patch.object(cp, "_meta_collection", return_value=coll):
        assert await cp.get_projection_version() is None
        await cp.save_projection_version(3)
        assert await cp.get_projection_version() == 3
        await cp.save_projection_version(4)
        assert await cp.get_projection_version() == 4

    assert list(coll.docs) == [cp.PROJECTION_VERSION_ID]


async def test_projection_version_store_ignores_garbage_value():
    coll = _FakeCollection()
    coll.docs[cp.PROJECTION_VERSION_ID] = {
        "_id": cp.PROJECTION_VERSION_ID,
        "version": "2",
    }
    with patch.object(cp, "_meta_collection", return_value=coll):
        assert await cp.get_projection_version() is None


async def test_bootstrap_checkpoint_uses_seq_read_before_the_scan():
    """A change landing mid-scan must be replayed by the tail, not skipped."""
    order: list[str] = []

    async def iter_all_docs(_database):
        order.append("scan")
        return
        yield  # pragma: no cover - makes this an async generator

    async def db_update_seq(_database):
        order.append("seq")
        return "7-x"

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs
    couch.db_update_seq = db_update_seq

    with patch.object(bs, "save_checkpoint", new_callable=AsyncMock) as save:
        await bs.bootstrap_database(couch, bs.REGISTRY_DB)

    assert order[0] == "seq"
    save.assert_awaited_once_with(bs.REGISTRY_DB, "7-x")
