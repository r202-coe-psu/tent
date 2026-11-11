"""Print-queue housekeeping loop (CR-222 FR-17).

Every ``PRINT_HOUSEKEEPING_INTERVAL_MS`` it POSTs the frontend's internal housekeeping endpoint
(sweep + retention live there, in TypeScript). After each 2xx it writes epoch ms to the OK file,
which the container healthcheck reads. The bearer token is never logged.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_MS = 30_000
DEFAULT_OK_FILE = "/tmp/print-housekeeping.ok"
DEFAULT_URL = "http://frontend:3000"
TIMEOUT_SECONDS = 25.0

_ENDPOINT_PATH = "/api/internal/printers/housekeeping"
_MIN_INTERVAL_MS = 1000


@dataclass(frozen=True)
class HousekeepingConfig:
    endpoint: str
    token: str = field(repr=False)
    interval_ms: int
    ok_file: str


def _parse_interval_ms(raw: str | None) -> int:
    try:
        value = int(raw) if raw else DEFAULT_INTERVAL_MS
    except ValueError:
        return DEFAULT_INTERVAL_MS
    return value if value >= _MIN_INTERVAL_MS else DEFAULT_INTERVAL_MS


def load_housekeeping_config(env: Mapping[str, str]) -> HousekeepingConfig | None:
    """Read the task config from ``env``; ``None`` when no token is set (task disabled)."""
    token = env.get("PRINT_HOUSEKEEPING_TOKEN", "")
    if not token:
        return None
    base_url = (env.get("PRINT_HOUSEKEEPING_URL") or DEFAULT_URL).removesuffix("/")
    return HousekeepingConfig(
        endpoint=f"{base_url}{_ENDPOINT_PATH}",
        token=token,
        interval_ms=_parse_interval_ms(env.get("PRINT_HOUSEKEEPING_INTERVAL_MS")),
        ok_file=env.get("PRINT_HOUSEKEEPING_OK_FILE") or DEFAULT_OK_FILE,
    )


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

    Never raises: a failure is logged (status or error name, never the token or the response
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
    except (httpx.HTTPError, OSError) as exc:
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
