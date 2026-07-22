from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class GeoPoint(BaseModel):
	lat: float
	lng: float


class PublicShelter(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	registry_id: str | None = None
	name: str
	status: str = "open"
	geo: GeoPoint | None = None
	capacity: int = 0
	province: str | None = None
	district: str | None = None
	subdistrict: str | None = None
	updated_at: datetime

	class Settings:
		name = "public_shelters"
		indexes = [
			IndexModel([("shelter_code", 1)]),
			IndexModel([("registry_id", 1)]),
			IndexModel([("province", 1), ("district", 1), ("subdistrict", 1)]),
			IndexModel([("status", 1)]),
		]
