from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class DonorBuffer(BaseModel):
	name: str
	phone: str
	line_id: str | None = None
	email: str | None = None


class DonationBuffer(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	donor: DonorBuffer
	# sha256 of normalize_phone(donor.phone) — the key the donor looks their bookings up
	# by when they have lost the booking ref (CR-173). None on rows written before it.
	donor_phone_hash: str | None = None
	# each item may carry "reserved_qty" (qty_str) = amount actually locked into
	# DonationNeedCounter.reserved_qty for that item (CR-045) — only present for
	# items with both campaign_id + item_id; absent for free-text/no-campaign items,
	# which bypass the counter entirely. cancel()/expire() release exactly this amount.
	# CR-174: each item also carries "review_status" (approved | pending | rejected),
	# computed by FastAPI at create/edit — approved iff the line holds a reservation in the
	# campaign — plus "review_reason_code"/"review_reason" on a rejected line. Inbound
	# copies the list to CouchDB whole, so the fields arrive there unchanged. ``status``
	# below is read off these lines (pending_review | verifying | rejected).
	items_declared: list[dict[str, Any]] = Field(default_factory=list)
	logistics: dict[str, Any] | None = None
	# ``DonationSlotCounter`` id this booking holds a place in — set only when the window
	# had a ceiling. Mongo-only: inbound copies named fields to CouchDB, never this one.
	# cancel()/expire()/settle release exactly this place.
	slot_counter_id: str | None = None
	campaign_id: str | None = None
	booking_ref: str
	tracking_token: str
	tracking_token_hash: str
	status: str = "declared"
	# Donor edits to items_declared, snapshot before/after (CR-080). Kept here as well as
	# on the CouchDB doc because a donation can be edited before inbound has persisted it
	# — inbound copies these across so the log survives the hand-off. Append-only.
	revisions: list[dict[str, Any]] = Field(default_factory=list)
	synced_to_couch: bool = False
	# CR-175 donor photos: ``image:{ulid}`` ids, copied to the CouchDB doc by inbound.
	photos: list[str] = Field(default_factory=list)
	# True once every photo carries this booking's ``donation_id`` or is gone (FR-11a).
	# A booking with no photos starts True; inbound retries the binding until it is.
	photos_linked: bool = True
	created_at: datetime
	expires_at: datetime | None = None

	class Settings:
		name = "donations"
		indexes = [
			IndexModel([("synced_to_couch", 1)]),
			IndexModel([("photos_linked", 1)]),
			IndexModel([("tracking_token_hash", 1)], unique=True),
			IndexModel([("booking_ref", 1)], unique=True),
			IndexModel([("donor_phone_hash", 1), ("created_at", -1)]),
		]
