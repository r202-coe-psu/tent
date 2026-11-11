"""Print-queue housekeeping loop (CR-222 FR-17).

Every ``PRINT_HOUSEKEEPING_INTERVAL_MS`` it POSTs the frontend's internal housekeeping endpoint
(sweep + retention live there, in TypeScript). After each 2xx it writes epoch ms to the OK file,
which the container healthcheck reads. The bearer token is never logged.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from pathlib import Path

import httpx

from worker.printing.config import HousekeepingConfig

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 25.0


def _write_ok_file(path: str, data: str) -> None:
    Path(path).write_text(data)


async def run_housekeeping_tick(
    client: httpx.AsyncClient,
    cfg: HousekeepingConfig,
    *,
    now: Callable[[], int],
    write_ok: Callable[[str, str], None],
) -> bool:
    """POST the housekeeping endpoint once.

    Never raises (only cancellation propagates): a failure is logged (status or error name, never the token or the response
    body) and reported as ``False``.
    """
    try:
        response = await client.post(
            cfg.endpoint,
            headers={"Authorization": f"Bearer {cfg.token}"},
            timeout=TIMEOUT_SECONDS,
        )
        if not response.is_success:
            logger.warning(
                "print housekeeping endpoint answered %s", response.status_code
            )
            return False
        write_ok(cfg.ok_file, str(now()))
        return True
    except Exception as exc:  # noqa: BLE001 — a dead task would stop housekeeping silently
        logger.warning("print housekeeping request failed: %s", type(exc).__name__)
        return False


async def run_print_housekeeping_loop(
    *,
    stop_event: asyncio.Event,
    cfg: HousekeepingConfig,
    client: httpx.AsyncClient | None = None,
) -> None:
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient()
    logger.info(
        "print housekeeping: posting %s every %s ms", cfg.endpoint, cfg.interval_ms
    )
    try:
        while not stop_event.is_set():
            await run_housekeeping_tick(
                client,
                cfg,
                now=lambda: time.time_ns() // 1_000_000,
                write_ok=_write_ok_file,
            )
            try:
                await asyncio.wait_for(stop_event.wait(), cfg.interval_ms / 1000)
            except TimeoutError:
                pass
    finally:
        if owns_client:
            await client.aclose()
    logger.info("print housekeeping: stopped")
