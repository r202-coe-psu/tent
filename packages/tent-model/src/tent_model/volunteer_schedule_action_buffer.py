from __future__ import annotations

from datetime import datetime
from typing import Literal

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class VolunteerScheduleActionBuffer(Document):
    """A volunteer-owned schedule action waiting to be applied to CouchDB.

    The public API can authenticate against the projected schedule, but it must not
    write a shelter database directly.  This buffer gives check-in, check-out and
    withdrawal the same durable hand-off as the other public volunteer writes.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    assignment_id: str
    shelter_code: str
    job_id: str
    shift_id: str | None = None
    volunteer_id: str
    action: Literal["check_in", "check_out", "withdraw"]
    requested_at: datetime
    synced_to_couch: bool = False

    class Settings:
        name = "volunteer_schedule_actions"
        indexes = [
            IndexModel([("synced_to_couch", 1)]),
            IndexModel([("assignment_id", 1), ("action", 1)], unique=True),
        ]
