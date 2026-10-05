"""One person's face check, kept in RAM only. Holds the chip photo's embedding (never the photo) and
the outcome; `clear()` wipes it. Nothing here is written to disk or logged."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

FLOW_CHECK_IN = "check_in"
FLOW_WALK_IN = "walk_in"
FLOWS = (FLOW_CHECK_IN, FLOW_WALK_IN)

REFERENCE_READING = "reading"
REFERENCE_READY = "ready"
REFERENCE_UNAVAILABLE = "unavailable"


@dataclass
class FaceSession:
    citizen_id: str
    flow: str
    started_at: float  # monotonic, for the TTL
    consented_at: str  # ISO-8601 UTC
    reference: Optional[np.ndarray] = None
    reference_state: str = REFERENCE_READING
    reference_reason: Optional[str] = None  # why the reference is unavailable
    reference_task: Optional[asyncio.Task] = field(default=None, repr=False)
    attempts: int = 0
    outcome: Optional[dict] = None  # final {result, reason, liveness}

    def set_reference(self, embedding: np.ndarray) -> None:
        self.reference = embedding
        self.reference_state = REFERENCE_READY

    def set_unavailable(self, reason: str) -> None:
        self.reference = None
        self.reference_state = REFERENCE_UNAVAILABLE
        self.reference_reason = reason

    def clear(self) -> None:
        if self.reference_task and not self.reference_task.done():
            self.reference_task.cancel()
        self.reference_task = None
        self.reference = None
