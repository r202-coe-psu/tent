"""Printing job (CR-222 FR-17) — HTTP faked with httpx.MockTransport."""

from __future__ import annotations

import asyncio
import logging

import httpx
import pytest

from worker.jobs.base import JobContext
from worker.jobs.printing import PrintingJob

TOKEN = "s3cret-token-value"
ENDPOINT = "http://frontend:3000/api/internal/printers/housekeeping"
ENV = {"PRINT_HOUSEKEEPING_TOKEN": TOKEN}


def make_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def ctx_for(client: httpx.AsyncClient) -> JobContext:
    return JobContext(http=client, stop=asyncio.Event(), deadline=None)


async def test_2xx_posts_with_bearer() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    async with make_client(handler) as client:
        await PrintingJob(ENV).run(ctx_for(client))

    assert len(seen) == 1
    assert seen[0].method == "POST"
    assert str(seen[0].url) == ENDPOINT
    assert seen[0].headers["authorization"] == f"Bearer {TOKEN}"


async def test_url_override_without_doubled_slash() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    env = {**ENV, "PRINT_HOUSEKEEPING_URL": "http://host.example:5173/"}
    async with make_client(handler) as client:
        await PrintingJob(env).run(ctx_for(client))

    assert (
        str(seen[0].url)
        == "http://host.example:5173/api/internal/printers/housekeeping"
    )


@pytest.mark.parametrize("status", [401, 503])
async def test_non_2xx_raises_without_token_or_body(status: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=f"body-with-{TOKEN}")

    async with make_client(handler) as client:
        with pytest.raises(RuntimeError) as info:
            await PrintingJob(ENV).run(ctx_for(client))

    assert str(status) in str(info.value)
    assert TOKEN not in str(info.value)


async def test_network_error_propagates() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    async with make_client(handler) as client:
        with pytest.raises(httpx.ConnectError):
            await PrintingJob(ENV).run(ctx_for(client))


async def test_no_token_makes_no_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not be called")

    async with make_client(handler) as client:
        await PrintingJob({}).run(ctx_for(client))


def test_job_metadata() -> None:
    job = PrintingJob({})
    assert job.name == "printing"
    assert job.budget_env is None
    assert job.default_budget_seconds is None


async def test_runner_logs_class_only(
    caplog: pytest.LogCaptureFixture, tmp_path
) -> None:
    from worker.jobs.runner import run_job

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text=TOKEN)

    env = {**ENV, "JOBS_OK_DIR": str(tmp_path)}
    with caplog.at_level(logging.WARNING):
        async with make_client(handler) as client:
            ok = await run_job(
                PrintingJob(env), http=client, stop=asyncio.Event(), env=env
            )

    assert ok is False
    assert TOKEN not in caplog.text
    assert not (tmp_path / "printing.ok").exists()
