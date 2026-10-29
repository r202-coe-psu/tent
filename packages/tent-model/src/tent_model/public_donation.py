from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class DeclaredItem(BaseModel):
	# Carried through even though no public surface renders it: the donor's edit form
	# sends the basket back whole, and an item returning without its item_id silently
	# stops being quota-tracked (CR-080).
	item_id: str | None = None
	item_name: str = ""
	qty: Any = None
	unit: str | None = None
	category: str | None = None
	# CR-196: the line's identity, which the donor's edit form sends back so an edit names
	# the held line it changes. Lines from before donation schema_v 8 have none.
	line_key: str | None = None
	# CR-174 FR-27: the per-line review (approved | pending | rejected) and, on a rejected
	# line only, why (code not_needed | expired | damaged | other, detail ≤500). Lines from
	# before donation schema_v 7 carry none and read back as None — the booking-level
	# status still applies to them.
	review_status: str | None = None
	review_reason_code: str | None = None
	review_reason: str | None = None


class PublicDonation(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	tracking_token_hash: str | None = None
	shelter_code: str
	status: str = "declared"
	booking_ref: str | None = None
	items_declared: list[DeclaredItem] = Field(default_factory=list)
	received_summary: dict[str, Any] | None = None
	# CR-172: the donor-facing reason (code label + detail, ≤500) and its code
	# (not_needed | expired | damaged | other). Set only on status rejected; docs
	# projected before schema_v 6 lack both and read back as None.
	reject_reason: str | None = None
	reject_reason_code: str | None = None
	updated_at: datetime

	class Settings:
		name = "public_donations"
		indexes = [
			IndexModel([("tracking_token_hash", 1)]),
			IndexModel([("shelter_code", 1)]),
		]
