"""Shelter import job (CR-123/126) — port of ``frontend/server/shelter-import-worker.mjs``.

One call to the internal route processes one import item (200) or reports an empty queue (204).
Repeats while the tick budget allows. Never logs the token or response bodies.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Mapping
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from worker.jobs.base import JobContext

logger = logging.getLogger(__name__)

DEFAULT_URL = "http://frontend:3000"
ROUTE = "/api/internal/shelter-import/worker/next"
DEFAULT_TIMEOUT_MS = 120_000
MIN_TIMEOUT_MS = 10_000


class ImportShelterJob:
    name = "import-shelter"
    budget_env = "JOBS_IMPORT_BUDGET_SECONDS"
    default_budget_seconds = 12.0

    def __init__(self, env: Mapping[str, str] | None = None) -> None:
        env = os.environ if env is None else env
        self._token = env.get("SHELTER_IMPORT_WORKER_TOKEN") or ""
        base = (env.get("SHELTER_IMPORT_WORKER_URL") or DEFAULT_URL).rstrip("/")
        self.endpoint = f"{base}{ROUTE}"
        self.worker_id = (
            env.get("SHELTER_IMPORT_WORKER_ID") or f"import-worker-{uuid.uuid4()}"
        )
        try:
            ms = float(env.get("SHELTER_IMPORT_WORKER_TIMEOUT_MS", ""))
        except ValueError:
            ms = DEFAULT_TIMEOUT_MS
        if not ms >= MIN_TIMEOUT_MS:  # also rejects NaN
            ms = DEFAULT_TIMEOUT_MS
        self.timeout_seconds = ms / 1000

    @property
    def enabled(self) -> bool:
        return bool(self._token)

    async def poll_once(self, http: httpx.AsyncClient) -> bool:
        """True when an item was processed (200); False on 204. Raises otherwise."""
        response = await http.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self._token}",
                "x-shelter-import-worker-id": self.worker_id,
            },
            timeout=self.timeout_seconds,
        )
        if response.status_code == 204:
            return False
        if response.status_code >= 400:
            # status only: the body may echo request data.
            raise RuntimeError(f"shelter-import worker endpoint {response.status_code}")
        try:
            result = response.json()
        except ValueError:
            result = {}
        if not isinstance(result, dict):
            result = {}
        logger.info(
            "import-shelter processed %s job=%s",
            result.get("itemId") or "item",
            result.get("jobId") or "unknown",
        )
        return True

    async def run(self, ctx: JobContext) -> None:
        if not self.enabled:
            logger.info("import-shelter disabled: SHELTER_IMPORT_WORKER_TOKEN unset")
            return
        while True:
            if not await self.poll_once(ctx.http):
                return
            if not ctx.should_continue():
                return
