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
	# CR-206 FR-MP-1: the drop-off point (``public_shelters.donation_points[].id``) the donor
	# takes this line to. None = no point — the line may be received at any point. Lines
	# from before donation schema_v 10 have none.
	drop_off_point_id: str | None = None


class DonationPointReceipt(BaseModel):
	"""One receipt at a drop-off point, reduced for the donor (CR-206 §Change).

	Only which lines a point recorded and when — never who recorded them, their remarks or
	the ledger/audit ids CouchDB keeps beside them.
	"""

	# None = recorded after the shelter had no drop-off point left (FR-MP-18b).
	point_id: str | None = None
	line_nos: list[int] = Field(default_factory=list)
	received_at: str | None = None


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
	# CR-206 FR-MP-5: lines each drop-off point has recorded. Empty until a point records
	# one, and on every doc projected before PROJECTION_VERSION 13.
	point_receipts: list[DonationPointReceipt] = Field(default_factory=list)
	updated_at: datetime

	class Settings:
		name = "public_donations"
		indexes = [
			IndexModel([("tracking_token_hash", 1)]),
			IndexModel([("shelter_code", 1)]),
		]
