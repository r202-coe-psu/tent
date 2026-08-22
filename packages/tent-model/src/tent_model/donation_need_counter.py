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

	``on_hand_qty`` is what the shelter's warehouse already holds of this item, tracked
	by the worker off the stock ledger. It is here because the reservation ceiling is
	``qty_target − on_hand_qty``, not ``qty_target``: a need is met once on-hand plus
	reserved reaches the target, which is the rule the needs board, the back-office
	board and the worker projector have all used since T-22. Without it the counter
	was the one place that still measured against the bare target, and it let two
	donors book 180 kg each against a 500 kg target the shelter already held 270 kg of.

	The full shelter balance is applied to every campaign asking for the item, matching
	``compute_needs``. When several open campaigns want the same item that under-books
	rather than over-books — the safe direction for a ceiling.
	"""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	campaign_id: str
	item_id: str
	qty_target: DecimalAnnotation
	reserved_qty: DecimalAnnotation = Decimal("0")
	on_hand_qty: DecimalAnnotation = Decimal("0")
	created_at: datetime
	updated_at: datetime
	last_recalculated_at: datetime | None = None

	class Settings:
		name = "donation_need_counters"
		indexes = [
			IndexModel([("shelter_code", 1), ("campaign_id", 1)]),
		]
