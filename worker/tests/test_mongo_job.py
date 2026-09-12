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
