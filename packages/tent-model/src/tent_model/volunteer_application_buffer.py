from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class ApplicantBuffer(BaseModel):
	"""The four-field quick-apply payload (FR-VOL-02.2) plus what we derive from it.

	``national_id`` is held in plaintext here only because the shelter's CouchDB doc
	needs it for Unified Person Identity (FR-VOL-01) and this buffer is the hand-off.
	It is dropped from the row once inbound has persisted it, and no read path returns
	it — see ``tent_model.public_job_application``.
	"""

	first_name: str
	last_name: str
	phone: str
	phone_hash: str
	national_id: str | None = None
	national_id_hash: str | None = None
	email: str | None = None
	skills: list[str] = Field(default_factory=list)


class SelectedShiftBuffer(BaseModel):
	date: str
	start_time: str
	end_time: str
	station: str | None = None


class VolunteerApplicationBuffer(Document):
	"""Public volunteer application awaiting persistence into CouchDB.

	Same shape of hand-off as ``DonationBuffer``: FastAPI writes here, the worker's
	inbound loop turns each row into ``job_application:{ulid}`` (and a central
	``volunteer:{ulid}`` profile) in ``shelter_{code}`` and flips ``synced_to_couch``.
	"""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	job_id: str
	volunteer_id: str
	applicant: ApplicantBuffer
	selected_shift: SelectedShiftBuffer
	tracking_token: str
	tracking_token_hash: str
	status: str = "pending_review"
	synced_to_couch: bool = False
	created_at: datetime

	class Settings:
		name = "volunteer_applications"
		indexes = [
			IndexModel([("synced_to_couch", 1)]),
			IndexModel([("tracking_token_hash", 1)], unique=True),
			IndexModel([("applicant.phone_hash", 1)]),
		]
