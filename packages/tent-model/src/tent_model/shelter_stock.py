"""Per-shelter stock balance projection (Mongo) — EXT-004, ADR 0002 §2/§5.

Projected by the sync worker from `stock_ledger` entries (CouchDB SoR); partner
reads are served from this collection only, never from CouchDB directly.
"""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel

# M6's own enum (partner ODT EXT-004) — `genaral` is M6's own spelling, preserved
# verbatim for interoperability rather than "corrected" to `general`.
M6_TYPE_CODES = ("food", "genaral", "medical-equipment", "medication")


class ShelterStock(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")  # f"{shelter_code}:{item_id}"
	shelter_code: str
	item_id: str  # → catalog item_master:{sku|ulid}, CouchDB SoR
	m6_reference_id: int | None = None
	m6_item_code: str | None = None
	name_th: str
	type_code: str
	unit_label: str
	unit_ratio: float = 1
	quantity_on_hand: float = 0
	source: str = "direct_donation"
	reorder_threshold: float | None = None
	updated_at: datetime

	class Settings:
		name = "shelter_stocks"
		indexes = [
			IndexModel([("shelter_code", 1)]),
			IndexModel([("shelter_code", 1), ("item_id", 1)], unique=True),
		]
