from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class PublicVolunteer(Document):
	"""Public read model of ``volunteer:{ulid}`` (schema.md §2.8).

	Exists so the Access Portal can show a volunteer their own profile and edit the parts
	they own. Everything here is data the same person can already read off their Digital
	Pass — the fields that must never leave CouchDB are simply absent rather than
	filtered at read time: no ``national_id``, no raw ``phone`` (masked only), no
	``user_name``, no ``tracking_token``.

	Reached by ``phone_hash``, the same key the schedule and the ticket lookup use. One
	row per shelter the person holds a profile at, because ``volunteer`` is a per-shelter
	document — the portal merges them for display.
	"""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	phone_hash: str | None = None
	first_name: str = ""
	last_name: str = ""
	nickname: str | None = None
	phone_masked: str = ""
	email: str | None = None
	volunteer_code: str = ""
	skills: list[str] = Field(default_factory=list)
	organization: str | None = None
	#: Set by staff only — the portal renders it as a badge and never offers to edit it.
	identity_verified: bool = False
	personnel_type: str = "volunteer"
	status: str = "active"
	updated_at: datetime

	class Settings:
		name = "public_volunteers"
		indexes = [
			IndexModel([("phone_hash", 1)]),
			IndexModel([("status", 1)]),
		]
