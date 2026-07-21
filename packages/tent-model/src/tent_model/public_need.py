from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class PublicNeed(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	item_name: str
	category: str
	qty_needed: float
	unit: str
	updated_at: datetime

	class Settings:
		name = "public_needs"
		indexes = [
			IndexModel([("shelter_code", 1)]),
			IndexModel([("category", 1)]),
		]
