from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import worker.mongo.job as job_module


class _Query:
    def __init__(self, rows: list[object]) -> None:
        self.rows = rows

    async def to_list(self) -> list[object]:
        return self.rows


@pytest.mark.asyncio
async def test_shift_reconcile_keeps_confirmed_unsynced_application_buffer(monkeypatch):
    counter = SimpleNamespace(
        confirmed_qty=99,
        dispatched_qty=0,
        updated_at=None,
        save=AsyncMock(),
    )
    job = SimpleNamespace(shifts=[SimpleNamespace(shift_id="shift:morning")])
    assignment = SimpleNamespace(
        status="assigned",
        dispatch_status="accepted",
        volunteer_id="volunteer:assigned",
    )
    projected_application = SimpleNamespace(
        id="job_application:projected",
        volunteer_id="volunteer:projected",
    )
    pending_buffer = SimpleNamespace(
        id="job_application:buffer",
        volunteer_id="volunteer:buffer",
    )

    monkeypatch.setattr(job_module.PublicJob, "get", AsyncMock(return_value=job))
    monkeypatch.setattr(
        job_module.PublicShiftAssignment,
        "find",
        lambda _query: _Query([assignment]),
    )
    monkeypatch.setattr(
        job_module.PublicJobApplication,
        "find",
        lambda _query: _Query([projected_application]),
    )
    monkeypatch.setattr(
        job_module.VolunteerApplicationBuffer,
        "find",
        lambda _query: _Query([pending_buffer]),
    )
    monkeypatch.setattr(
        job_module.VolunteerJobShiftSlot, "get", AsyncMock(return_value=counter)
    )

    await job_module.sync_job_shift_slot(job_id="job:1", shift_id="shift:morning")

    assert counter.confirmed_qty == 3
    counter.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_application_upsert_reconciles_its_shift_counter(monkeypatch):
    # CR-220: a ticket cancel without an assignment changes only the application, and one
    # with an assignment changes the application last; both must move the public counter.
    apply_document = AsyncMock()
    sync = AsyncMock()
    monkeypatch.setattr(job_module, "apply_document", apply_document)
    monkeypatch.setattr(job_module, "sync_job_shift_slot", sync)

    payload = {
        "_id": "job_application:1",
        "job_id": "job:1",
        "shift_id": "shift:morning",
    }
    await job_module.apply_job_application("upsert", payload)

    apply_document.assert_awaited_once_with(
        job_module.PublicJobApplication, "upsert", payload
    )
    sync.assert_awaited_once_with(job_id="job:1", shift_id="shift:morning")


@pytest.mark.asyncio
async def test_application_delete_reconciles_the_shift_it_held(monkeypatch):
    sync = AsyncMock()
    previous = SimpleNamespace(job_id="job:1", shift_id="shift:morning")
    monkeypatch.setattr(job_module, "apply_document", AsyncMock())
    monkeypatch.setattr(job_module, "sync_job_shift_slot", sync)
    monkeypatch.setattr(
        job_module.PublicJobApplication, "get", AsyncMock(return_value=previous)
    )

    await job_module.apply_job_application("delete", {"_id": "job_application:1"})

    sync.assert_awaited_once_with(job_id="job:1", shift_id="shift:morning")


@pytest.mark.asyncio
async def test_application_without_a_shift_leaves_counters_alone(monkeypatch):
    sync = AsyncMock()
    monkeypatch.setattr(job_module, "apply_document", AsyncMock())
    monkeypatch.setattr(job_module, "sync_job_shift_slot", sync)

    await job_module.apply_job_application(
        "upsert", {"_id": "job_application:1", "job_id": "job:1", "shift_id": None}
    )

    sync.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancelled_application_drops_out_of_the_shift_count(monkeypatch):
    # The linked ticket-cancel order: assignment cancelled first, application last. Once the
    # application is cancelled too, neither counts.
    counter = SimpleNamespace(
        confirmed_qty=2, dispatched_qty=0, updated_at=None, save=AsyncMock()
    )
    job = SimpleNamespace(shifts=[SimpleNamespace(shift_id="shift:morning")])
    cancelled_assignment = SimpleNamespace(
        status="cancelled", dispatch_status="accepted", volunteer_id="volunteer:a"
    )
    other = SimpleNamespace(id="job_application:b", volunteer_id="volunteer:b")
    monkeypatch.setattr(job_module.PublicJob, "get", AsyncMock(return_value=job))
    monkeypatch.setattr(
        job_module.PublicShiftAssignment,
        "find",
        lambda _q: _Query([cancelled_assignment]),
    )
    # The mock returns only a confirmed row, so the filter itself is asserted on the
    # query it receives below, not inferred from the result.
    application_queries: list[dict] = []

    def _find_applications(query):
        application_queries.append(query)
        return _Query([other])

    monkeypatch.setattr(job_module.PublicJobApplication, "find", _find_applications)
    monkeypatch.setattr(
        job_module.VolunteerApplicationBuffer, "find", lambda _q: _Query([])
    )
    monkeypatch.setattr(
        job_module.VolunteerJobShiftSlot, "get", AsyncMock(return_value=counter)
    )

    await job_module.sync_job_shift_slot(job_id="job:1", shift_id="shift:morning")

    assert counter.confirmed_qty == 1
    assert application_queries == [
        {"job_id": "job:1", "shift_id": "shift:morning", "status": "confirmed"}
    ]


@pytest.mark.asyncio
async def test_application_without_reconcile_defers_the_counter_and_returns_its_shift(
    monkeypatch,
):
    # Bootstrap replays every application; it reconciles once per shift afterwards.
    sync = AsyncMock()
    monkeypatch.setattr(job_module, "apply_document", AsyncMock())
    monkeypatch.setattr(job_module, "sync_job_shift_slot", sync)

    pair = await job_module.apply_job_application(
        "upsert",
        {"_id": "job_application:1", "job_id": "job:1", "shift_id": "shift:morning"},
        reconcile=False,
    )

    assert pair == ("job:1", "shift:morning")
    sync.assert_not_awaited()


@pytest.mark.asyncio
async def test_assignment_without_reconcile_defers_the_counter_and_returns_its_shift(
    monkeypatch,
):
    sync = AsyncMock()
    monkeypatch.setattr(job_module, "apply_document", AsyncMock())
    monkeypatch.setattr(job_module, "sync_job_shift_slot", sync)

    pair = await job_module.apply_shift_assignment(
        "upsert",
        {"_id": "shift_assignment:1", "job_id": "job:1", "shift_id": "shift:morning"},
        reconcile=False,
    )

    assert pair == ("job:1", "shift:morning")
    sync.assert_not_awaited()
