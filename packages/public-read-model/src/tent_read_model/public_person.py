from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel, TEXT


class PublicPerson(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	first_name: str
	last_name_masked: str
	phone_hash: str | None = None
	status: str
	updated_at: datetime

	class Settings:
		name = "public_persons"
		indexes = [
			IndexModel([("first_name", TEXT), ("last_name_masked", TEXT)]),
			IndexModel([("phone_hash", 1)]),
			IndexModel([("shelter_code", 1)]),
		]
