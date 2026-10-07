"""Partner booking buffer (M2, CR-154 EXT-008–010; schema.md §9.7).

FastAPI inserts a row per accepted booking; the sync worker inbound loop writes the
CouchDB `household` + `evacuee` (`pre_registered`, `registered_via: api`) and then
clears the PII fields here. No `schema_v` — Beanie doc, additive fields only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel

ExternalBookingState = Literal["pending", "written", "cancelled", "rejected"]

# States that hold a booking slot: a second booking with the same CID at the same
# shelter is refused while one of these exists (D5 — duplicates across shelters OK).
OPEN_BOOKING_STATES: tuple[str, ...] = ("pending", "written")


class ExternalBooking(Document):
	model_config = ConfigDict(populate_by_name=True)

	# `_id` == `booking_id` (`BK-{ulid}`)
	id: str = Field(alias="_id")
	booking_id: str
	client_id: str
	module_name: str | None = None
	shelter_code: str
	# Plaintext PII — needed until the worker writes CouchDB; cleared to None once the
	# booking is written, cancelled or rejected.
	cid: str | None = None
	cid_hash: str
	first_name: str | None = None
	last_name: str | None = None
	phone: str | None = None
	state: ExternalBookingState = "pending"
	cancel_requested: bool = False
	cancel_reason: str | None = None
	# "duplicate" | "not_cancellable"
	reject_reason: str | None = None
	# Reserved before the first CouchDB write so worker retries stay idempotent.
	evacuee_id: str | None = None
	household_id: str | None = None
	created_at: datetime
	updated_at: datetime

	def clear_pii(self) -> None:
		self.cid = None
		self.first_name = None
		self.last_name = None
		self.phone = None

	class Settings:
		name = "external_bookings"
		indexes = [
			IndexModel(
				[("shelter_code", 1), ("cid_hash", 1)],
				unique=True,
				name="uniq_open_booking_per_shelter",
				partialFilterExpression={"state": {"$in": list(OPEN_BOOKING_STATES)}},
			),
			IndexModel([("state", 1), ("updated_at", 1)]),
			IndexModel([("cancel_requested", 1)]),
			IndexModel([("client_id", 1)]),
		]
