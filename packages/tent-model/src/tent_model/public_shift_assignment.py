from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class DutyWindow(BaseModel):
    start_ts: datetime | None = None
    end_ts: datetime | None = None


class PublicShiftAssignment(Document):
    """Public snapshot of ``shift_assignment:{ulid}`` (schema.md §2.9, CR-092).

    This — not ``job_application`` — is the volunteer's actual schedule. An application
    says "I asked for this"; an assignment says "you are on at this time, at this
    station", and carries the duty window, the check-in stamps and the dispatch state
    the Access Portal renders.

    ``phone_hash`` is denormalised from the volunteer's profile at projection time so
    the portal can answer "what am I on for" from a phone number alone. Without it the
    only route in would be through an application, which misses every volunteer a
    manager assigned directly.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    shelter_code: str
    job_id: str
    # Stable reference to job.shifts[].shift_id. Empty only for legacy projections.
    shift_id: str = ""
    volunteer_id: str
    #: SHA-256 of the volunteer's normalised phone. The number itself is never here.
    phone_hash: str | None = None
    #: SHA-256 of the short code a manager reads out when offering this shift. Only the
    #: hash: staff read the code off the CouchDB document, and a public collection must
    #: not be able to hand out something that answers on the volunteer's behalf.
    response_code_hash: str | None = None
    date: str = ""
    shift: str = ""
    station: str = ""
    duty_window: DutyWindow = Field(default_factory=DutyWindow)
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    # CR-092: assigned | standby | checked_in | completed | no_show | cancelled
    status: str = "assigned"
    # CR-092 FR-VOL-06: dispatched | accepted | declined | None
    dispatch_status: str | None = None
    updated_at: datetime

    class Settings:
        name = "public_shift_assignments"
        indexes = [
            IndexModel([("phone_hash", 1)]),
            IndexModel([("volunteer_id", 1)]),
            IndexModel([("job_id", 1)]),
            IndexModel([("job_id", 1), ("shift_id", 1)]),
            IndexModel([("job_id", 1), ("shift_id", 1), ("volunteer_id", 1)]),
            IndexModel([("shelter_code", 1)]),
        ]
