"""ShelterCloseJob (CR-243 FR-15/FR-16) — HTTP faked with httpx.MockTransport."""

from __future__ import annotations

import asyncio
import logging

import httpx
import pytest

from worker.jobs.shelter_close import (
    ShelterCloseConfigError,
    ShelterCloseJob,
    parse_timings,
)

TOKEN = "s3cret-close-token"
ENV = {"SHELTER_CLOSE_WORKER_TOKEN": TOKEN}


class Ctx:
    def __init__(self, http: httpx.AsyncClient, allow: int = 10**6) -> None:
        self.http = http
        self.stop = asyncio.Event()
        self.deadline = None
        self._allow = allow

    def budget_left(self) -> float:
        return 1.0

    def should_continue(self) -> bool:
        self._allow -= 1
        return self._allow > 0


def client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_metadata_and_defaults():
    job = ShelterCloseJob(ENV)
    assert job.name == "shelter-close"
    assert job.budget_env == "JOBS_CLOSE_BUDGET_SECONDS"
    assert job.default_budget_seconds == 10
    assert (
        job.endpoint
        == "http://host.docker.internal:5173/api/internal/shelter-close/worker/next"
    )
    assert job.worker_id.startswith("shelter-close-worker-")
    assert parse_timings({}) == {
        "timeout": 30_000,
        "chunk_budget": 20_000,
        "lease": 60_000,
        "stale": 600_000,
    }


def test_overrides_and_trailing_slash():
    job = ShelterCloseJob(
        {
            **ENV,
            "SHELTER_CLOSE_WORKER_URL": "http://app:5173/",
            "SHELTER_CLOSE_WORKER_ID": "c1",
        }
    )
    assert job.endpoint == "http://app:5173/api/internal/shelter-close/worker/next"
    assert job.worker_id == "c1"
    t = parse_timings(
        {
            "SHELTER_CLOSE_CHUNK_BUDGET_MS": "10",
            "SHELTER_CLOSE_WORKER_TIMEOUT_MS": "20",
            "SHELTER_CLOSE_LEASE_MS": "30",
            "SHELTER_CLOSE_STALE_MS": "40",
        }
    )
    assert t == {"chunk_budget": 10, "timeout": 20, "lease": 30, "stale": 40}


@pytest.mark.parametrize("raw", ["abc", "0", "-5", "nan", "inf"])
@pytest.mark.parametrize(
    "name",
    [
        "SHELTER_CLOSE_WORKER_TIMEOUT_MS",
        "SHELTER_CLOSE_CHUNK_BUDGET_MS",
        "SHELTER_CLOSE_LEASE_MS",
        "SHELTER_CLOSE_STALE_MS",
    ],
)
def test_rejects_non_positive_or_non_numeric(name, raw):
    with pytest.raises(ShelterCloseConfigError, match=name):
        parse_timings({name: raw})


@pytest.mark.parametrize(
    "env",
    [
        {"SHELTER_CLOSE_CHUNK_BUDGET_MS": "30000"},  # == timeout
        {"SHELTER_CLOSE_WORKER_TIMEOUT_MS": "60000"},  # == lease
        {"SHELTER_CLOSE_LEASE_MS": "600000"},  # == stale
        {"SHELTER_CLOSE_STALE_MS": "50000"},  # < lease
    ],
)
def test_ordering_violations_rejected(env):
    with pytest.raises(
        ShelterCloseConfigError, match="CHUNK_BUDGET_MS < WORKER_TIMEOUT_MS"
    ):
        parse_timings(env)


async def test_disabled_without_token_makes_no_call():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(204)

    job = ShelterCloseJob({})
    assert not job.enabled
    async with client(handler) as http:
        await job.run(Ctx(http))
    assert calls == []


async def test_invalid_ordering_fails_run_before_any_call():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(204)

    job = ShelterCloseJob({**ENV, "SHELTER_CLOSE_CHUNK_BUDGET_MS": "40000"})
    async with client(handler) as http:
        with pytest.raises(ShelterCloseConfigError):
            await job.run(Ctx(http))
    assert calls == []


async def test_one_call_per_chunk_until_204_with_headers():
    seen = []
    responses = [
        httpx.Response(200, json={"jobId": "j1", "status": "running"}),
        httpx.Response(200, json={"job_id": "j1", "status": "done"}),
        httpx.Response(204),
    ]

    def handler(req: httpx.Request):
        seen.append(req)
        return responses[len(seen) - 1]

    job = ShelterCloseJob({**ENV, "SHELTER_CLOSE_WORKER_ID": "c1"})
    async with client(handler) as http:
        await job.run(Ctx(http))
    assert len(seen) == 3
    assert seen[0].method == "POST"
    assert seen[0].headers["authorization"] == f"Bearer {TOKEN}"
    assert seen[0].headers["x-shelter-close-worker-id"] == "c1"


async def test_stops_between_calls_when_budget_out():
    n = 0

    def handler(req):
        nonlocal n
        n += 1
        return httpx.Response(200, json={"jobId": "j"})

    async with client(handler) as http:
        await ShelterCloseJob(ENV).run(Ctx(http, allow=2))
    assert n == 2


async def test_tolerates_non_json_200_body():
    def handler(req):
        return httpx.Response(200, text="ok")

    async with client(handler) as http:
        await ShelterCloseJob(ENV).run(Ctx(http, allow=1))


async def test_non_2xx_raises_without_leaking_body_or_token():
    def handler(req):
        return httpx.Response(502, text=f"bad gateway {TOKEN}")

    async with client(handler) as http:
        with pytest.raises(RuntimeError) as exc:
            await ShelterCloseJob(ENV).run(Ctx(http))
    assert "502" in str(exc.value)
    assert TOKEN not in str(exc.value) and "bad gateway" not in str(exc.value)


async def test_logs_job_and_status_only(caplog):
    caplog.set_level(logging.INFO)

    def handler(req):
        return httpx.Response(
            200, json={"jobId": "j1", "status": "running", "people": ["x"]}
        )

    async with client(handler) as http:
        await ShelterCloseJob(ENV).run(Ctx(http, allow=1))
    assert "job=j1 status=running" in caplog.text
    assert TOKEN not in caplog.text and "people" not in caplog.text


async def test_timeout_propagates():
    def handler(req):
        raise httpx.ReadTimeout("slow", request=req)

    async with client(handler) as http:
        with pytest.raises(httpx.ReadTimeout):
            await ShelterCloseJob(ENV).run(Ctx(http))
