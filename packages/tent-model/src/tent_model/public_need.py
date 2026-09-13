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
	#: The terms the shortage is made of, so the donor board can show a real progress
	#: bar (it used to invent `target = qty × 2`). Optional with a 0 default: rows
	#: projected before this existed have none and must still load.
	qty_target: float = 0.0
	on_hand: float = 0.0
	reserved: float = 0.0
	unit: str
	updated_at: datetime

	class Settings:
		name = "public_needs"
		indexes = [
			IndexModel([("shelter_code", 1)]),
			IndexModel([("category", 1)]),
		]
