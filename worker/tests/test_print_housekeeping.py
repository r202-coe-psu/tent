"""Print housekeeping tick + loop (CR-222 FR-17) — HTTP faked with httpx.MockTransport."""

from __future__ import annotations

import asyncio
import logging
import time

import httpx
import pytest

from worker.printing.config import HousekeepingConfig, load_housekeeping_config
from worker.printing.housekeeping import (
    run_housekeeping_tick,
    run_print_housekeeping_loop,
)

TOKEN = "s3cret-token-value"
ENDPOINT = "http://frontend:3000/api/internal/printers/housekeeping"
OK_FILE = "/tmp/test-print-housekeeping.ok"


def make_cfg(
    *, endpoint: str = ENDPOINT, interval_ms: int = 30_000, ok_file: str = OK_FILE
) -> HousekeepingConfig:
    return HousekeepingConfig(
        endpoint=endpoint, token=TOKEN, interval_ms=interval_ms, ok_file=ok_file
    )


def make_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class Writes:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def __call__(self, path: str, data: str) -> None:
        self.calls.append((path, data))


async def test_2xx_posts_with_bearer_and_writes_ok_file_with_now() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    writes = Writes()
    async with make_client(handler) as client:
        ok = await run_housekeeping_tick(
            client, make_cfg(), now=lambda: 1_700_000_000_123, write_ok=writes
        )

    assert ok is True
    assert len(seen) == 1
    assert seen[0].method == "POST"
    assert str(seen[0].url) == ENDPOINT
    assert seen[0].headers["authorization"] == f"Bearer {TOKEN}"
    assert writes.calls == [(OK_FILE, "1700000000123")]


@pytest.mark.parametrize("status", [401, 503])
async def test_non_2xx_returns_false_without_write_and_logs_status_only(
    status: int, caplog: pytest.LogCaptureFixture
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=f"body-with-{TOKEN}")

    writes = Writes()
    with caplog.at_level(logging.WARNING):
        async with make_client(handler) as client:
            ok = await run_housekeeping_tick(
                client, make_cfg(), now=lambda: 1, write_ok=writes
            )

    assert ok is False
    assert writes.calls == []
    assert str(status) in caplog.text
    assert TOKEN not in caplog.text


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("boom"),
        httpx.ReadTimeout("slow"),
    ],
)
async def test_network_error_does_not_raise_or_write_and_never_logs_token(
    error: httpx.HTTPError, caplog: pytest.LogCaptureFixture
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    writes = Writes()
    with caplog.at_level(logging.WARNING):
        async with make_client(handler) as client:
            ok = await run_housekeeping_tick(
                client, make_cfg(), now=lambda: 1, write_ok=writes
            )

    assert ok is False
    assert writes.calls == []
    assert type(error).__name__ in caplog.text
    assert TOKEN not in caplog.text


def test_endpoint_is_built_from_url_without_doubling_trailing_slash() -> None:
    cfg = load_housekeeping_config(
        {
            "PRINT_HOUSEKEEPING_TOKEN": TOKEN,
            "PRINT_HOUSEKEEPING_URL": "http://host.example:5173/",
        }
    )

    assert cfg is not None
    assert cfg.endpoint == "http://host.example:5173/api/internal/printers/housekeeping"


def test_defaults_when_only_token_is_set() -> None:
    cfg = load_housekeeping_config({"PRINT_HOUSEKEEPING_TOKEN": TOKEN})

    assert cfg is not None
    assert cfg.endpoint == ENDPOINT
    assert cfg.interval_ms == 30_000
    assert cfg.ok_file == "/tmp/print-housekeeping.ok"
    assert TOKEN not in repr(cfg)


def test_ok_file_comes_from_env() -> None:
    cfg = load_housekeeping_config(
        {"PRINT_HOUSEKEEPING_TOKEN": TOKEN, "PRINT_HOUSEKEEPING_OK_FILE": "/run/x.ok"}
    )

    assert cfg is not None
    assert cfg.ok_file == "/run/x.ok"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("", 30_000), ("abc", 30_000), ("500", 30_000), ("5000", 5_000)],
)
def test_interval_parsing(raw: str, expected: int) -> None:
    cfg = load_housekeeping_config(
        {"PRINT_HOUSEKEEPING_TOKEN": TOKEN, "PRINT_HOUSEKEEPING_INTERVAL_MS": raw}
    )

    assert cfg is not None
    assert cfg.interval_ms == expected


@pytest.mark.parametrize("env", [{}, {"PRINT_HOUSEKEEPING_TOKEN": ""}])
def test_empty_or_missing_token_disables_the_task(env: dict[str, str]) -> None:
    assert load_housekeeping_config(env) is None


async def test_loop_returns_promptly_when_stop_is_set_during_sleep(tmp_path) -> None:
    stop_event = asyncio.Event()
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200)

    cfg = make_cfg(interval_ms=3_600_000, ok_file=str(tmp_path / "hk.ok"))
    async with make_client(handler) as client:
        task = asyncio.create_task(
            run_print_housekeeping_loop(stop_event=stop_event, cfg=cfg, client=client)
        )
        async with asyncio.timeout(2):
            while calls == 0 and not task.done():
                await asyncio.sleep(0.01)
        started = time.monotonic()
        stop_event.set()
        await asyncio.wait_for(task, timeout=1.0)

    assert time.monotonic() - started < 1.0
    assert calls == 1
    assert (tmp_path / "hk.ok").read_text().isdigit()


async def test_malformed_url_does_not_raise_or_write(
    caplog: pytest.LogCaptureFixture,
) -> None:
    writes = Writes()
    with caplog.at_level(logging.WARNING):
        async with httpx.AsyncClient() as client:
            ok = await run_housekeeping_tick(
                client,
                make_cfg(endpoint="http://[::1/api/internal/printers/housekeeping"),
                now=lambda: 1,
                write_ok=writes,
            )

    assert ok is False
    assert writes.calls == []
    assert "InvalidURL" in caplog.text
    assert TOKEN not in caplog.text
