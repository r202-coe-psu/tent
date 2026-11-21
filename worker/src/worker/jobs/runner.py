"""jobs-worker loop: one tick every ``JOBS_TICK_SECONDS`` running each enabled job in order.

Each job has its own try/except and budget; a failure never fails the tick. After a successful
run a per-job OK file (epoch ms) is written for the container healthcheck. Ticks never overlap:
if one overruns the tick length the next starts immediately, otherwise the remainder is slept
(interruptible by shutdown).
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

import httpx

from worker.jobs.base import Job, JobContext
from worker.jobs.config import (
    is_job_enabled,
    job_budget_seconds,
    ok_dir,
    ok_path,
    tick_seconds,
)

logger = logging.getLogger(__name__)


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


def _write_ok_file(path: str, data: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(data)


def clear_stale_ok_files(env: Mapping[str, str], jobs: Sequence[Job]) -> None:
    # /tmp survives `docker restart`; a stale stamp would make the first probes lie.
    for job in jobs:
        Path(ok_path(env, job.name)).unlink(missing_ok=True)


async def run_job(
    job: Job,
    *,
    http: httpx.AsyncClient,
    stop: asyncio.Event,
    env: Mapping[str, str],
    now_ms: Callable[[], int] = _now_ms,
    write_ok: Callable[[str, str], None] = _write_ok_file,
) -> bool:
    """Run one job; never raises (only cancellation propagates)."""
    budget = job_budget_seconds(env, job.budget_env, job.default_budget_seconds)
    deadline = None if budget is None else time.monotonic() + budget
    ctx = JobContext(http=http, stop=stop, deadline=deadline)
    try:
        await job.run(ctx)
    except Exception as exc:  # noqa: BLE001 — one job must not fail the tick
        logger.warning("job %s failed: %s", job.name, type(exc).__name__)
        return False
    try:
        write_ok(ok_path(env, job.name), str(now_ms()))
    except OSError as exc:
        logger.warning("job %s ok-file write failed: %s", job.name, type(exc).__name__)
    return True


async def run_tick(
    jobs: Sequence[Job],
    *,
    http: httpx.AsyncClient,
    stop: asyncio.Event,
    env: Mapping[str, str],
    now_ms: Callable[[], int] = _now_ms,
    write_ok: Callable[[str, str], None] = _write_ok_file,
) -> None:
    for job in jobs:
        if stop.is_set():
            return
        if not is_job_enabled(job.name, env):
            continue
        await run_job(
            job, http=http, stop=stop, env=env, now_ms=now_ms, write_ok=write_ok
        )


async def run_loop(
    jobs: Sequence[Job],
    *,
    stop: asyncio.Event,
    env: Mapping[str, str],
    http: httpx.AsyncClient | None = None,
) -> None:
    tick = tick_seconds(env)
    owns_http = http is None
    if http is None:
        http = httpx.AsyncClient()
    enabled = [j.name for j in jobs if is_job_enabled(j.name, env)]
    logger.info("jobs-worker: tick %ss, jobs %s", tick, enabled)
    Path(ok_dir(env)).mkdir(parents=True, exist_ok=True)
    clear_stale_ok_files(env, jobs)
    try:
        while not stop.is_set():
            started = time.monotonic()
            await run_tick(jobs, http=http, stop=stop, env=env)
            remaining = tick - (time.monotonic() - started)
            if remaining > 0 and not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), remaining)
                except TimeoutError:
                    pass
    finally:
        for job in jobs:
            aclose = getattr(job, "aclose", None)
            if aclose is not None:
                try:
                    await aclose()
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "job %s close failed: %s", job.name, type(exc).__name__
                    )
        if owns_http:
            await http.aclose()
    logger.info("jobs-worker: stopped")


async def run() -> None:
    from worker.jobs import JOBS

    stop = asyncio.Event()

    def _handle_signal() -> None:
        logger.info("Shutdown requested")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)
    await run_loop(JOBS, stop=stop, env=os.environ)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    asyncio.run(run())


if __name__ == "__main__":
    main()
