from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from beanie import DecimalAnnotation, Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class DonationNeedCounter(Document):
	"""Atomic quota reservation counter — 1 doc per (shelter_code, campaign_id, item_id).

	``qty_target`` is written once by the worker projector on first CDC sight of the
	campaign need (CR-059) and is fixed thereafter; only the DR recalculation tool may
	change it. ``reserved_qty`` is owned by FastAPI (CR-045) via atomic ``$inc``.
	"""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	campaign_id: str
	item_id: str
	qty_target: DecimalAnnotation
	reserved_qty: DecimalAnnotation = Decimal("0")
	created_at: datetime
	updated_at: datetime
	last_recalculated_at: datetime | None = None

	class Settings:
		name = "donation_need_counters"
		indexes = [
			IndexModel([("shelter_code", 1), ("campaign_id", 1)]),
		]
