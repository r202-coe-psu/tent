"""Shelter close job (CR-243 FR-15/FR-16) — port of ``frontend/server/shelter-close-worker.mjs``.

1 call = 1 chunk. Repeats until 204 or the tick budget runs out. Never logs token or body.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Mapping
from itertools import pairwise
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from worker.jobs.base import JobContext

logger = logging.getLogger(__name__)

DEFAULT_URL = "http://host.docker.internal:5173"
ROUTE = "/api/internal/shelter-close/worker/next"
DEFAULTS_MS = {
    "timeout": 30_000,
    "chunk_budget": 20_000,
    "lease": 60_000,
    "stale": 600_000,
}
ENV_NAMES = {
    "timeout": "SHELTER_CLOSE_WORKER_TIMEOUT_MS",
    "chunk_budget": "SHELTER_CLOSE_CHUNK_BUDGET_MS",
    "lease": "SHELTER_CLOSE_LEASE_MS",
    "stale": "SHELTER_CLOSE_STALE_MS",
}


class ShelterCloseConfigError(ValueError):
    pass


def parse_timings(env: Mapping[str, str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key, name in ENV_NAMES.items():
        raw = env.get(name)
        if raw is None or raw == "":
            out[key] = DEFAULTS_MS[key]
            continue
        try:
            n = float(raw)
        except ValueError:
            n = float("nan")
        if not n > 0 or n == float("inf"):
            raise ShelterCloseConfigError(
                f"{name} must be a positive number (got {raw!r})"
            )
        out[key] = n
    validate_ordering(out)
    return out


def validate_ordering(t: Mapping[str, float]) -> None:
    """FR-16: CHUNK_BUDGET_MS < TIMEOUT_MS < LEASE_MS < STALE_MS."""
    chain = [
        (ENV_NAMES[k], t[k]) for k in ("chunk_budget", "timeout", "lease", "stale")
    ]
    for (a, av), (b, bv) in pairwise(chain):
        if not av < bv:
            raise ShelterCloseConfigError(
                f"invalid timing config: {a} ({av:g}) must be less than {b} ({bv:g}); "
                "required order CHUNK_BUDGET_MS < WORKER_TIMEOUT_MS < LEASE_MS < STALE_MS"
            )


class ShelterCloseJob:
    name = "shelter-close"
    budget_env = "JOBS_CLOSE_BUDGET_SECONDS"
    default_budget_seconds = 10.0

    def __init__(self, env: Mapping[str, str] | None = None) -> None:
        self._env = os.environ if env is None else env
        self._token = self._env.get("SHELTER_CLOSE_WORKER_TOKEN") or ""
        base = (self._env.get("SHELTER_CLOSE_WORKER_URL") or DEFAULT_URL).rstrip("/")
        self.endpoint = f"{base}{ROUTE}"
        self.worker_id = (
            self._env.get("SHELTER_CLOSE_WORKER_ID")
            or f"shelter-close-worker-{uuid.uuid4()}"
        )

    @property
    def enabled(self) -> bool:
        return bool(self._token)

    async def poll_once(self, http: httpx.AsyncClient, timeout_seconds: float) -> bool:
        """True when a chunk was processed (200); False on 204. Raises otherwise."""
        response = await http.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self._token}",
                "x-shelter-close-worker-id": self.worker_id,
            },
            timeout=timeout_seconds,
        )
        if response.status_code == 204:
            return False
        if response.status_code >= 400:
            raise RuntimeError(f"shelter-close worker endpoint {response.status_code}")
        try:
            result = response.json()
        except ValueError:
            result = {}
        if not isinstance(result, dict):
            result = {}
        job_id = result.get("jobId") or result.get("job_id") or "unknown"
        status = result.get("status")
        logger.info(
            "shelter-close processed chunk job=%s%s",
            job_id,
            f" status={status}" if status else "",
        )
        return True

    async def run(self, ctx: JobContext) -> None:
        if not self.enabled:
            logger.info("shelter-close disabled: SHELTER_CLOSE_WORKER_TOKEN unset")
            return
        timeout_seconds = parse_timings(self._env)["timeout"] / 1000
        while True:
            if not await self.poll_once(ctx.http, timeout_seconds):
                return
            if not ctx.should_continue():
                return
