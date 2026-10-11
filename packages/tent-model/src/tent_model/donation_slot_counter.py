from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field


class DonationSlotCounter(Document):
	"""Atomic place counter for one capped queue window — 1 doc per (shelter, mode, date, from).

	The public spec has ``POST /public/v1/donations`` refuse ``SLOT_FULL`` atomically at
	submit. Counting bookings in CouchDB cannot do that: a booking only reaches CouchDB
	after FastAPI → Mongo → sync worker, so two donors pressing confirm together both read
	the last place free. This counter is what decides instead, the same way
	``DonationNeedCounter`` decides ``NEED_FULL``.

	Only ``booked`` lives here. The ceiling is the window's ``capacity`` as the BFF read
	it from CouchDB on that request, so staff changing it takes effect on the next
	booking without a projector. Windows without a ceiling never get a counter.

	``booked`` is seeded once from the CouchDB count the BFF sends with the first booking,
	which covers places taken before the counter existed; from then on only
	``reserve_slot``/``release_slot`` move it.
	"""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	booked: int = 0
	created_at: datetime
	updated_at: datetime

	class Settings:
		name = "donation_slot_counters"
