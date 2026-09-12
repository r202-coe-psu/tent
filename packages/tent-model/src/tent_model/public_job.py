from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class ShiftTemplate(BaseModel):
    shift_name: str = ""
    start_time: str = ""
    end_time: str = ""
    days: list[str] = Field(default_factory=list)


class JobShift(BaseModel):
    """A concrete, publicly selectable sub-shift of a volunteer job.

    ``shift_id`` is the stable identity.  The date/time fields remain a snapshot so
    clients can render a ticket without joining back to CouchDB.
    """

    shift_id: str
    date: str = ""
    end_date: str | None = None
    start_time: str = ""
    end_time: str = ""
    station: str | None = None
    quota: int = 0
    slots_confirmed: int = 0
    slots_dispatched: int = 0
    slots_remaining: int = 0


class PublicJob(Document):
    """Public snapshot of a volunteer ``job`` doc, stored in MongoDB ``public_jobs``.

    Sourced from ``job:{ulid}`` in CouchDB ``shelter_{code}`` (schema.md §2.17, CR-092).

    ``required_roles`` is deliberately absent: it names internal RoleKeys, and the public
    board only has to say whether a job needs a system account (``tier``), not which
    permission it would hand out.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    shelter_code: str
    title: str = ""
    description: str = ""
    tier: str = "operational"
    skills_required: list[str] = Field(default_factory=list)
    quota: int = 0
    # CR-092 3-colour quota. slots_remaining is stored rather than derived so the board
    # and the dispatch workspace read the same number even mid-projection.
    slots_confirmed: int = 0
    slots_dispatched: int = 0
    slots_remaining: int = 0
    shift_template: ShiftTemplate = Field(default_factory=ShiftTemplate)
    shifts: list[JobShift] = Field(default_factory=list)
    auto_accept: bool = False
    status: str = "open"
    updated_at: datetime

    class Settings:
        name = "public_jobs"
        indexes = [
            IndexModel([("shelter_code", 1)]),
            IndexModel([("status", 1)]),
        ]
