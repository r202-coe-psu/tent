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

	# NNN-XXXX-XX-NNN (e.g. 390-XXXX-XX-192)
	national_id_masked: str | None = None
	national_id_hash: str | None = None

	# AA1234567 (e.g. A...ZNNNNNN)
	passport_id_masked: str | None = None
	passport_hash: str | None = None

	# Masked Address (e.g. **/* ถ.นิพัทธ์อุทิศ 1 ต.หาดใหญ่ อ.หาดใหญ่ จ.สงขลา)
	address_masked: str | None = None

	phone_hash: str | None = None
	gender: str | None = None
	checked_in_at: datetime | None = None
	care_zone: str | None = None # (e.g. โซนที่ General)

	# Disable in Search
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
		]
