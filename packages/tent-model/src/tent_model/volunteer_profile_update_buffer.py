from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class ProfileUpdateTarget(BaseModel):
	"""One ``volunteer`` document this edit has to land on.

	Resolved by FastAPI from the public read model rather than searched for by the
	worker: ``volunteer`` is a per-shelter document and the same person can hold one at
	several shelters, so an edit names every document it means to touch instead of
	leaving the worker to guess which shelter "their profile" lives in.
	"""

	shelter_code: str
	volunteer_id: str


class VolunteerProfileUpdateBuffer(Document):
	"""A profile edit made from the Access Portal, waiting to reach CouchDB.

	Mirrors ``volunteer_application_buffer``: the public plane cannot write to CouchDB,
	so FastAPI records the request here and the worker applies it to the shelter's own
	document, which stays the system of record.

	Carries only what the volunteer owns. Anything staff decide — ``identity_verified``,
	``status``, ``volunteer_code``, ``personnel_type`` — is deliberately absent, so a
	request from the public plane cannot express a change to it even if forged.
	"""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	phone_hash: str
	targets: list[ProfileUpdateTarget] = Field(default_factory=list)
	skills: list[str] = Field(default_factory=list)
	requested_at: datetime
	synced_to_couch: bool = False

	class Settings:
		name = "volunteer_profile_updates"
		indexes = [
			IndexModel([("synced_to_couch", 1)]),
			IndexModel([("phone_hash", 1)]),
		]
