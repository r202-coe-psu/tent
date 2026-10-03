"""Atomic place operations on ``donation_slot_counter``.

FastAPI reserves a place when it accepts a booking; every path that releases quota
(FastAPI cancel, worker retention and settle) releases the place too. They all call
these so the increment/decrement guards stay in one place, mirroring
``donation_need_counter_ops``.
"""

from __future__ import annotations

from datetime import datetime

from pymongo.errors import DuplicateKeyError

from tent_model.donation_slot_counter import DonationSlotCounter


def slot_counter_id(shelter_code: str, mode: str, date: str, start: str) -> str:
	"""Same identity as the window's ``donation_slot:{mode}:{date}:{from}`` doc, per shelter."""
	return f"{shelter_code}:{mode}:{date}:{start}"


async def reserve_slot(*, counter_id: str, capacity: int, baseline: int, now: datetime) -> bool:
	"""Take one place iff fewer than ``capacity`` are held. Returns ``False`` when full.

	The first booking for a window creates its counter at ``baseline`` — the places the
	BFF counted in CouchDB, i.e. bookings made before the counter existed. Two first
	bookings racing both try the insert; the loser's ``DuplicateKeyError`` just means the
	counter is there now, and the guarded ``$inc`` below decides for both.
	"""
	collection = DonationSlotCounter.get_pymongo_collection()
	try:
		await collection.update_one(
			{"_id": counter_id},
			{
				"$setOnInsert": {"booked": max(baseline, 0), "created_at": now},
				"$set": {"updated_at": now},
			},
			upsert=True,
		)
	except DuplicateKeyError:
		pass

	updated = await collection.find_one_and_update(
		{"_id": counter_id, "booked": {"$lt": capacity}},
		{"$inc": {"booked": 1}, "$set": {"updated_at": now}},
	)
	return updated is not None


async def release_slot(*, counter_id: str, now: datetime) -> None:
	"""Give one place back — no-op once the counter is at 0 (duplicate cancel/expire)."""
	await DonationSlotCounter.get_pymongo_collection().find_one_and_update(
		{"_id": counter_id, "booked": {"$gt": 0}},
		{"$inc": {"booked": -1}, "$set": {"updated_at": now}},
	)
