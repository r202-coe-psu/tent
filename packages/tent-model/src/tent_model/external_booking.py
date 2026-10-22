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

# Result of the worker's reconcile pass over a terminal row (#613). `cancelled`: a stay or
# household reserved by the row was cancelled now (or its missing partner audit was written
# now); `advanced`: the stay had moved past pre_registered and was left alone; `missing`: no
# reserved doc exists; `noop`: nothing left to do, including a doc cancelled by someone else
# (no partner audit is written for it).
ExternalBookingReconcileOutcome = Literal["cancelled", "advanced", "missing", "noop"]


class ExternalBooking(Document):
	model_config = ConfigDict(populate_by_name=True)

	# `_id`: `BP-{ulid}` per row (rows written before CR-169 still use `BK-…` == `booking_id`)
	id: str = Field(alias="_id")
	# `BK-{ulid}` — group key shared by every row of one request (CR-169 C4)
	booking_id: str
	# Position in `persons[]` (0-based) and size of the whole group
	person_seq: int = 0
	group_size: int = 1
	# False while the API is still staging the group's rows; workers skip those (FR-32)
	committed: bool = True
	# True only when the row was booked under `booking-bypass` against a shelter that failed the
	# normal rule (#751). Additive: legacy rows lack the key and read as False; no schema_v.
	bypass: bool = False
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
	# Id of the cancel request that set `cancel_requested` while it is in flight (CR-169 FR-40).
	# Cleared when that request succeeds or reverts its flag; a failed revert leaves it set. A flag
	# without a token is finished (due for the worker); the worker skips a tokened flag and reverts
	# it once `cancel_flag_set_at` is older than 2 minutes (abandoned request).
	cancel_flag_token: str | None = None
	# When `cancel_flag_token` was set (API clock); cleared with it.
	cancel_flag_set_at: datetime | None = None
	# "duplicate" | "not_cancellable"
	reject_reason: str | None = None
	# Reserved before the first CouchDB write so worker retries stay idempotent.
	evacuee_id: str | None = None
	household_id: str | None = None
	# Set once the worker's reconcile pass has finished a terminal (`cancelled` / `rejected`)
	# row against its reserved CouchDB docs (#613). Unset (missing or null) = not yet; a
	# transient CouchDB error leaves it unset so the next pass retries.
	reconciled_at: datetime | None = None
	reconcile_outcome: ExternalBookingReconcileOutcome | None = None
	# Per-doc reconcile markers (#613, decision sync review รอบ 3): the exact ISO-8601 string
	# the worker writes when it cancels the doc — the stay's `current_stay.since` and the
	# household's `updated_at` — stamped before that write. The retry pass writes the
	# partner audit of a cancelled doc only when the doc's timestamp equals its marker; any
	# other value means someone else (e.g. staff) cancelled it → no partner audit.
	reconcile_stay_cancelled_at: str | None = None
	reconcile_household_cancelled_at: str | None = None
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
			IndexModel([("booking_id", 1), ("person_seq", 1)]),
			IndexModel([("state", 1), ("updated_at", 1)]),
			IndexModel([("state", 1), ("reconciled_at", 1)]),
			IndexModel([("cancel_requested", 1)]),
			IndexModel([("client_id", 1)]),
		]
