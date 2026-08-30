"""Public transparency aggregate schemas (Mongo read models)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class TransparencySummary(BaseModel):
    shelters_total: int = Field(ge=0)
    shelters_open: int = Field(ge=0, description="status in {open, full}")
    occupancy_total: int | None = Field(
        default=None,
        description="active + pre_registered across projected shelters (CR-070)",
    )
    vulnerable_count: int | None = Field(
        default=None,
        description="Not projected in public_persons yet — always null until schema adds age",
    )


class TransparencySummaryResponse(BaseModel):
    summary: TransparencySummary
    last_updated: datetime
    is_stale: bool = False
    flags: dict[str, bool] = Field(
        default_factory=lambda: {
            "public_metrics_occupancy": True,
            "public_metrics_vulnerable": True,
            "emergency_mode": True,
        }
    )
