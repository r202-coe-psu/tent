from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class ApplicantSnapshot(BaseModel):
    """What the ticket may show back to the applicant.

    No ``national_id`` and no raw phone: FR-VOL-03.4 forbids returning the ID number at
    all, and the ticket shows the phone masked. Both are held on the CouchDB doc for the
    shelter; the public read model never carries them so a Mongo read cannot leak them.
    """

    first_name: str = ""
    last_name: str = ""
    phone_masked: str = ""
    skills: list[str] = Field(default_factory=list)


class SelectedShift(BaseModel):
    shift_id: str | None = None
    date: str = ""
    start_time: str = ""
    end_time: str = ""
    station: str | None = None


class PublicJobApplication(Document):
    """Public snapshot of ``job_application:{ulid}`` (schema.md §2.18, CR-092).

    Read by the Digital Pass at ``/volunteer/ticket/:token``. Reached only by
    ``tracking_token_hash`` — the raw token is 128 bits and never stored.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    shelter_code: str
    job_id: str
    volunteer_id: str | None = None
    # Additive identity for the selected concrete sub-shift.  None is retained only
    # for pre-shift-id projections during the compatibility window.
    shift_id: str | None = None
    tracking_token_hash: str
    phone_hash: str | None = None
    applicant: ApplicantSnapshot = Field(default_factory=ApplicantSnapshot)
    selected_shift: SelectedShift = Field(default_factory=SelectedShift)
    # CR-092: confirmed (auto-accepted) | pending_review (controlled skill) | cancelled
    status: str = "pending_review"
    created_at: datetime | None = None
    updated_at: datetime

    class Settings:
        name = "public_job_applications"
        indexes = [
            IndexModel([("tracking_token_hash", 1)]),
            IndexModel([("phone_hash", 1)]),
            IndexModel([("job_id", 1)]),
        ]
