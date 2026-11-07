from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from beanie import DecimalAnnotation, Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class PublicNeed(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	#: CR-206 A2: a row is one card = shelter + item_id + drop-off point. Optional so rows
	#: projected before 15 (no such fields) still load.
	item_id: str | None = None
	drop_off_point_id: str | None = None
	item_name: str
	category: str
	#: Quantities are ``Decimal128`` in Mongo (#934, same as ``donation_need_counter``);
	#: rows projected before that hold a ``double`` and still load (pydantic accepts it).
	qty_needed: DecimalAnnotation
	#: The terms the shortage is made of, so the donor board can show a real progress
	#: bar (it used to invent `target = qty × 2`). Optional with a 0 default: rows
	#: projected before this existed have none and must still load.
	qty_target: DecimalAnnotation = Decimal("0")
	on_hand: DecimalAnnotation = Decimal("0")
	reserved: DecimalAnnotation = Decimal("0")
	unit: str
	#: Highest urgency across the open campaigns asking for this item.
	urgency: str = "normal"
	updated_at: datetime

	class Settings:
		name = "public_needs"
		indexes = [
			IndexModel([("shelter_code", 1)]),
			IndexModel([("category", 1)]),
		]
