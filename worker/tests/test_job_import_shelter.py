"""ImportShelterJob — HTTP faked with httpx.MockTransport."""

from __future__ import annotations

import asyncio
import logging

import httpx
import pytest

from worker.jobs.import_shelter import ImportShelterJob

TOKEN = "s3cret-import-token"
ENV = {"SHELTER_IMPORT_WORKER_TOKEN": TOKEN}


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
    job = ImportShelterJob(ENV)
    assert job.name == "import-shelter"
    assert job.budget_env == "JOBS_IMPORT_BUDGET_SECONDS"
    assert job.default_budget_seconds == 12
    assert (
        job.endpoint == "http://frontend:3000/api/internal/shelter-import/worker/next"
    )
    assert job.timeout_seconds == 120
    assert job.worker_id.startswith("import-worker-")


def test_env_overrides_and_timeout_floor():
    job = ImportShelterJob(
        {
            **ENV,
            "SHELTER_IMPORT_WORKER_URL": "http://app:3000/",
            "SHELTER_IMPORT_WORKER_ID": "w1",
            "SHELTER_IMPORT_WORKER_TIMEOUT_MS": "5000",
        }
    )
    assert job.endpoint == "http://app:3000/api/internal/shelter-import/worker/next"
    assert job.worker_id == "w1"
    assert job.timeout_seconds == 120  # below the 10s minimum -> default
    assert (
        ImportShelterJob(
            {**ENV, "SHELTER_IMPORT_WORKER_TIMEOUT_MS": "15000"}
        ).timeout_seconds
        == 15
    )


async def test_disabled_without_token_makes_no_call():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(204)

    job = ImportShelterJob({})
    assert not job.enabled
    async with client(handler) as http:
        await job.run(Ctx(http))
    assert calls == []


async def test_drains_until_204_sending_headers():
    seen = []
    responses = [
        httpx.Response(200, json={"itemId": "i1", "jobId": "j1"}),
        httpx.Response(200, json={"itemId": "i2", "jobId": "j1"}),
        httpx.Response(204),
    ]

    def handler(req: httpx.Request):
        seen.append(req)
        return responses[len(seen) - 1]

    job = ImportShelterJob({**ENV, "SHELTER_IMPORT_WORKER_ID": "w1"})
    async with client(handler) as http:
        await job.run(Ctx(http))
    assert len(seen) == 3
    assert seen[0].method == "POST"
    assert seen[0].headers["authorization"] == f"Bearer {TOKEN}"
    assert seen[0].headers["x-shelter-import-worker-id"] == "w1"


async def test_stops_between_calls_when_budget_out():
    n = 0

    def handler(req):
        nonlocal n
        n += 1
        return httpx.Response(200, json={"itemId": "i", "jobId": "j"})

    async with client(handler) as http:
        await ImportShelterJob(ENV).run(Ctx(http, allow=3))  # continue True,True,False
    assert n == 3


async def test_non_2xx_raises_without_leaking_body_or_token(caplog):
    def handler(req):
        return httpx.Response(500, text=f"boom body {TOKEN}")

    async with client(handler) as http:
        with pytest.raises(RuntimeError) as exc:
            await ImportShelterJob(ENV).run(Ctx(http))
    assert "500" in str(exc.value)
    assert TOKEN not in str(exc.value) and "boom" not in str(exc.value)


async def test_logs_ids_only_never_token(caplog):
    caplog.set_level(logging.INFO)

    def handler(req):
        return httpx.Response(200, json={"itemId": "i1", "jobId": "j1", "secret": "x"})

    async with client(handler) as http:
        await ImportShelterJob(ENV).run(Ctx(http, allow=1))
    text = caplog.text
    assert "i1" in text and "j1" in text
    assert TOKEN not in text and "secret" not in text


async def test_timeout_propagates():
    def handler(req):
        raise httpx.ReadTimeout("slow", request=req)

    async with client(handler) as http:
        with pytest.raises(httpx.ReadTimeout):
            await ImportShelterJob(ENV).run(Ctx(http))
