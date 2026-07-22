from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel, TEXT


class PublicPerson(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	first_name: str
	last_name_masked: str

	national_id_masked: str | None = None
	national_id_hash: str | None = None
	passport_id_masked: str | None = None
	passport_hash: str | None = None

	address_masked: str | None = None
	phone_hash: str | None = None
	gender: str | None = None
	checked_in_at: datetime | None = None
	care_zone: str | None = None
	household_id: str | None = None

	search_excluded: bool = False
	status: str
	updated_at: datetime

	class Settings:
		name = "public_persons"
		indexes = [
			IndexModel([("first_name", TEXT), ("last_name_masked", TEXT)]),
			IndexModel([("national_id_hash", 1)]),
			IndexModel([("passport_hash", 1)]),
			IndexModel([("phone_hash", 1)]),
			IndexModel([("shelter_code", 1)]),
			IndexModel([("household_id", 1)]),
		]
