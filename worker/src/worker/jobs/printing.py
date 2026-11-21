"""Print-queue housekeeping job (CR-222 FR-17), ported from ``worker.printing``.

One POST per tick to the frontend's internal housekeeping endpoint (sweep + retention live
there, in TypeScript). The bearer token is never logged.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from worker.jobs.base import JobContext

DEFAULT_URL = "http://frontend:3000"
_ENDPOINT_PATH = "/api/internal/printers/housekeeping"
TIMEOUT_SECONDS = 25.0


class PrintingJob:
    name = "printing"
    budget_env: str | None = None
    default_budget_seconds: float | None = None

    def __init__(self, env: Mapping[str, str] | None = None) -> None:
        self._env = os.environ if env is None else env

    async def run(self, ctx: JobContext) -> None:
        token = self._env.get("PRINT_HOUSEKEEPING_TOKEN", "")
        if not token:
            return
        base = (self._env.get("PRINT_HOUSEKEEPING_URL") or DEFAULT_URL).removesuffix(
            "/"
        )
        response = await ctx.http.post(
            f"{base}{_ENDPOINT_PATH}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT_SECONDS,
        )
        if not response.is_success:
            # Status only: never the token or the response body.
            raise RuntimeError(
                f"print housekeeping endpoint answered {response.status_code}"
            )


def build() -> PrintingJob:
    return PrintingJob()
