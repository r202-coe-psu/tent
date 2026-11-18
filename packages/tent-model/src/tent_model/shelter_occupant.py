"""Per-shelter occupant projection (Mongo) — EXT-007, ADR 0002 §6.

Projected by the sync worker from active `evacuee` entries (CouchDB SoR); partner
reads are served from this collection only, never from CouchDB directly. Holds plaintext
PII since CR-257 — never serialize a row as a whole into a response.
"""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class ShelterOccupant(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")  # f"{shelter_code}:{evacuee_id}"
	shelter_code: str
	occupant_ref: str
	# Plaintext (CR-257) — `None` on rows projected before PROJECTION_VERSION 23. The API
	# masks the name for `occupancy-pii-read` and returns it whole only with `pii-full`.
	first_name: str | None = None
	last_name: str | None = None
	age: int | None = None
	national_id: str | None = None
	passport_id: str | None = None
	id_card_type: str | None = None
	phone: str | None = None
	# Deprecated (CR-257): worker output before PROJECTION_VERSION 23; masked-path fallback only.
	name_masked: str | None = None
	age_range: str
	gender: str | None = None
	care_flags: list[str] = Field(default_factory=list)
	checked_in_at: datetime | None = None
	updated_at: datetime

	class Settings:
		name = "shelter_occupants"
		indexes = [
			IndexModel([("shelter_code", 1)]),
			IndexModel([("shelter_code", 1), ("occupant_ref", 1)], unique=True),
		]
