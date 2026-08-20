from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class GeoPoint(BaseModel):
	lat: float
	lng: float


class GeoJsonPoint(BaseModel):
	type: str = "Point"
	coordinates: list[float]  # [longitude, latitude]


class PublicShelter(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	registry_id: str | None = None
	name: str
	status: str = "open"
	location: GeoJsonPoint | None = None
	geo: GeoPoint | None = None
	capacity: int = 0
	province: str | None = None
	district: str | None = None
	subdistrict: str | None = None
	raw_data: dict[str, Any] = Field(default_factory=dict)
	updated_at: datetime

	class Settings:
		name = "public_shelters"
		indexes = [
			IndexModel([("location", "2dsphere")]),
			IndexModel([("shelter_code", 1)]),
			IndexModel([("registry_id", 1)]),
			IndexModel([("province", 1), ("district", 1), ("subdistrict", 1)]),
			IndexModel([("status", 1)]),
		]

