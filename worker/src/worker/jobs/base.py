"""Job interface for the merged ``jobs-worker`` (issue #1479)."""

from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass
class JobContext:
    http: httpx.AsyncClient
    stop: asyncio.Event
    deadline: float | None = None

    def budget_left(self) -> float:
        """Seconds left in this job's budget (``inf`` without a deadline), never negative."""
        if self.deadline is None:
            return math.inf
        return max(0.0, self.deadline - time.monotonic())

    def should_continue(self) -> bool:
        """Checked BETWEEN calls; a call in flight is never cut."""
        return not self.stop.is_set() and self.budget_left() > 0


class Job(Protocol):
    name: str
    budget_env: str | None
    default_budget_seconds: float | None

    async def run(self, ctx: JobContext) -> None:
        """Raise on failure; returning normally is success (empty/204 counts)."""
        ...
