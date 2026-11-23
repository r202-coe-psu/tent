"""jobs-worker runner: order, budget, isolation, no overlap, OK files."""

from __future__ import annotations

import asyncio
import time

import httpx

from worker.jobs.base import JobContext
from worker.jobs.config import (
    is_job_enabled,
    job_budget_seconds,
    job_interval_seconds,
    max_age_seconds,
)
from worker.jobs.runner import clear_stale_ok_files, run_job, run_loop


class FakeJob:
    budget_env: str | None = None
    default_budget_seconds: float | None = None

    def __init__(
        self, name: str, log: list[str] | None = None, *, fail: bool = False
    ) -> None:
        self.name = name
        self.log = log if log is not None else []
        self.fail = fail
        self.ctxs: list[JobContext] = []

    async def run(self, ctx: JobContext) -> None:
        self.ctxs.append(ctx)
        self.log.append(self.name)
        if self.fail:
            raise ValueError("secret-body")


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200))
    )


async def run_once(jobs, tmp_path, env_extra=None) -> list[str]:
    """Run ``run_loop`` until every job has run once, then stop it."""
    stop = asyncio.Event()
    env = {
        "JOBS_OK_DIR": str(tmp_path),
        "JOBS_TICK_SECONDS": "3600",
        **(env_extra or {}),
    }
    async with client() as http:
        task = asyncio.create_task(run_loop(jobs, stop=stop, env=env, http=http))
        enabled = [j for j in jobs if is_job_enabled(j.name, env)]
        async with asyncio.timeout(2):
            while not all(j.ctxs for j in enabled):
                await asyncio.sleep(0.01)
        await asyncio.sleep(0.02)
        stop.set()
        await asyncio.wait_for(task, 1.0)
    return [j.name for j in jobs if j.ctxs]


async def test_every_job_runs_in_its_own_loop_and_writes_ok_files(tmp_path) -> None:
    jobs = [FakeJob("printing"), FakeJob("edge-users-copy")]
    ran = await run_once(jobs, tmp_path, {"PRINT_HOUSEKEEPING_TOKEN": "t"})

    assert ran == ["printing", "edge-users-copy"]
    assert (tmp_path / "printing.ok").read_text().isdigit()
    assert (tmp_path / "edge-users-copy.ok").read_text().isdigit()


async def test_slow_job_does_not_delay_other_jobs(tmp_path) -> None:
    stop = asyncio.Event()
    fast_runs = 0

    class Blocked(FakeJob):
        async def run(self, ctx: JobContext) -> None:
            await ctx.stop.wait()  # in-flight call that only ends on shutdown

    class Fast(FakeJob):
        async def run(self, ctx: JobContext) -> None:
            nonlocal fast_runs
            fast_runs += 1
            if fast_runs >= 3:
                stop.set()

    env = {
        "JOBS_OK_DIR": str(tmp_path),
        "SHELTER_IMPORT_WORKER_TOKEN": "t",
        "JOBS_EDGE_USERS_COPY_INTERVAL_SECONDS": "0.01",
    }
    async with client() as http:
        await asyncio.wait_for(
            run_loop(
                [Blocked("import-shelter"), Fast("edge-users-copy")],
                stop=stop,
                env=env,
                http=http,
            ),
            5,
        )

    assert fast_runs == 3


def test_interval_resolution_and_healthcheck_age() -> None:
    assert job_interval_seconds({}, "printing") == 10
    assert job_interval_seconds({}, "edge-users-copy") == 10
    assert job_interval_seconds({}, "import-shelter") == 30
    assert job_interval_seconds({}, "shelter-close") == 30
    assert job_interval_seconds({}, "unknown") == 30
    # own env wins over the shared default, which wins over the built-in
    env = {"JOBS_TICK_SECONDS": "60", "JOBS_IMPORT_INTERVAL_SECONDS": "5"}
    assert job_interval_seconds(env, "import-shelter") == 5
    assert job_interval_seconds(env, "printing") == 60
    assert (
        job_interval_seconds({"JOBS_CLOSE_INTERVAL_SECONDS": "bad"}, "shelter-close")
        == 30
    )
    # healthcheck age = max(120 s, 4 x that job's interval)
    assert max_age_seconds({}, "printing") == 120
    assert (
        max_age_seconds({"JOBS_IMPORT_INTERVAL_SECONDS": "60"}, "import-shelter") == 240
    )


async def test_failure_is_isolated_and_writes_no_ok(tmp_path, caplog) -> None:
    log: list[str] = []
    jobs = [FakeJob("printing", log, fail=True), FakeJob("edge-users-copy", log)]
    await run_once(jobs, tmp_path, {"PRINT_HOUSEKEEPING_TOKEN": "t"})

    assert sorted(log) == ["edge-users-copy", "printing"]
    assert not (tmp_path / "printing.ok").exists()
    assert (tmp_path / "edge-users-copy.ok").exists()
    assert "ValueError" in caplog.text
    assert "secret-body" not in caplog.text


async def test_disabled_job_is_skipped(tmp_path) -> None:
    log: list[str] = []
    jobs = [FakeJob("printing", log), FakeJob("edge-users-copy", log)]
    env = {"JOBS_OK_DIR": str(tmp_path)}  # no print token
    await run_once(jobs, tmp_path)

    assert log == ["edge-users-copy"]
    assert not is_job_enabled("import-shelter", env)
    assert is_job_enabled("import-shelter", {"SHELTER_IMPORT_WORKER_TOKEN": "x"})


async def test_budget_from_env_sets_deadline(tmp_path) -> None:
    job = FakeJob("import-shelter")
    job.budget_env = "JOBS_IMPORT_BUDGET_SECONDS"
    job.default_budget_seconds = 30
    env = {"JOBS_OK_DIR": str(tmp_path), "JOBS_IMPORT_BUDGET_SECONDS": "5"}
    async with client() as http:
        await run_job(job, http=http, stop=asyncio.Event(), env=env)
        await run_job(
            job, http=http, stop=asyncio.Event(), env={"JOBS_OK_DIR": str(tmp_path)}
        )

    assert 4 < job.ctxs[0].budget_left() <= 5
    assert 28 < job.ctxs[1].budget_left() <= 30


def test_budget_parsing() -> None:
    assert job_budget_seconds({}, None, None) is None
    assert job_budget_seconds({}, "X", 10) == 10
    assert job_budget_seconds({"X": "3"}, "X", 10) == 3
    assert job_budget_seconds({"X": "bad"}, "X", 10) == 10
    assert job_budget_seconds({"X": "-1"}, "X", 10) == 10


async def test_context_budget_and_stop() -> None:
    stop = asyncio.Event()
    async with client() as http:
        ctx = JobContext(http=http, stop=stop, deadline=None)
        assert ctx.budget_left() == float("inf")
        assert ctx.should_continue()
        stop.set()
        assert not ctx.should_continue()
        expired = JobContext(
            http=http, stop=asyncio.Event(), deadline=time.monotonic() - 1
        )
        assert expired.budget_left() == 0.0
        assert not expired.should_continue()


async def test_stale_ok_files_cleared(tmp_path) -> None:
    (tmp_path / "printing.ok").write_text("1")
    clear_stale_ok_files({"JOBS_OK_DIR": str(tmp_path)}, [FakeJob("printing")])
    assert not (tmp_path / "printing.ok").exists()


async def test_loop_no_overlap_when_tick_overruns(tmp_path) -> None:
    stop = asyncio.Event()
    active = 0
    max_active = 0
    runs = 0

    class Slow(FakeJob):
        async def run(self, ctx: JobContext) -> None:
            nonlocal active, max_active, runs
            active += 1
            max_active = max(max_active, active)
            runs += 1
            await asyncio.sleep(0.05)
            active -= 1
            if runs >= 3:
                stop.set()

    env = {"JOBS_OK_DIR": str(tmp_path), "JOBS_TICK_SECONDS": "0.01"}
    async with client() as http:
        await asyncio.wait_for(
            run_loop([Slow("edge-users-copy")], stop=stop, env=env, http=http), 5
        )

    assert runs == 3
    assert max_active == 1


async def test_loop_sleeps_remainder_and_stops_promptly(tmp_path) -> None:
    stop = asyncio.Event()
    job = FakeJob("edge-users-copy")
    env = {"JOBS_OK_DIR": str(tmp_path), "JOBS_TICK_SECONDS": "3600"}
    async with client() as http:
        task = asyncio.create_task(run_loop([job], stop=stop, env=env, http=http))
        async with asyncio.timeout(2):
            while not job.log:
                await asyncio.sleep(0.01)
        await asyncio.sleep(0.05)
        stop.set()
        await asyncio.wait_for(task, 1.0)

    assert job.log == ["edge-users-copy"]
