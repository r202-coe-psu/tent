"""jobs-worker: every enabled job runs in its own loop, concurrently, at its own interval.

Each job has its own try/except and budget, so a slow or failing job never delays another.
Loops are fixed-period (start to start): a run that overruns its interval is followed
immediately by the next one, and runs of one job never overlap; otherwise the remainder is
slept (interruptible by shutdown). After a successful run a per-job OK file (epoch ms) is
written for the container healthcheck.
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
    job_interval_seconds,
    ok_dir,
    ok_path,
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


async def run_loop(
    jobs: Sequence[Job],
    *,
    stop: asyncio.Event,
    env: Mapping[str, str],
    http: httpx.AsyncClient | None = None,
) -> None:
    owns_http = http is None
    if http is None:
        http = httpx.AsyncClient()
    enabled = [j for j in jobs if is_job_enabled(j.name, env)]
    logger.info(
        "jobs-worker: %s",
        ", ".join(
            f"{j.name} every {job_interval_seconds(env, j.name):g}s" for j in enabled
        ),
    )
    Path(ok_dir(env)).mkdir(parents=True, exist_ok=True)
    clear_stale_ok_files(env, jobs)
    client = http

    async def job_loop(job: Job) -> None:
        interval = job_interval_seconds(env, job.name)
        while not stop.is_set():
            started = time.monotonic()
            await run_job(job, http=client, stop=stop, env=env)
            remaining = interval - (time.monotonic() - started)
            if remaining > 0 and not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), remaining)
                except TimeoutError:
                    pass

    tasks = [asyncio.create_task(job_loop(j), name=f"job-{j.name}") for j in enabled]
    try:
        await asyncio.gather(*tasks)
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
        for task in tasks:
            task.cancel()
        if owns_http:
            await client.aclose()
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
