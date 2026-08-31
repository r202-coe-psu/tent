"""Atomic head-count counter for a volunteer ``job`` — 1 doc per job.

Same job as ``donation_need_counter`` does for goods: two people hitting
"สมัครกะนี้" on the last free slot must not both get a confirmed ticket, and a
read-then-write in FastAPI cannot promise that. Every mutation of ``confirmed_qty``
lives in this module — do not ``$inc`` it from anywhere else.

Difference from the donation counter, on purpose: ``quota`` is ``$set`` on every
projection rather than ``$setOnInsert``. A shelter manager may raise or lower a job's
head count while it is open (MA-18 / CR-092 FR-VOL-06), so the ceiling has to follow the
job doc — where a campaign's ``qty_target`` is deliberately frozen.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class VolunteerJobSlot(Document):
	model_config = ConfigDict(populate_by_name=True)

	#: The CouchDB ``job:{ulid}`` id.
	id: str = Field(alias="_id")
	shelter_code: str
	quota: int = 0
	#: Applications holding a confirmed ticket. Owned by FastAPI via atomic ``$inc``.
	confirmed_qty: int = 0
	#: Offers a manager has pushed out that the volunteer has not answered yet
	#: (CR-092 🟡). Owned by the back-office dispatch flow; counted against the ceiling
	#: here so a public applicant cannot take a slot that is already promised.
	dispatched_qty: int = 0
	created_at: datetime
	updated_at: datetime

	class Settings:
		name = "volunteer_job_slots"
		indexes = [IndexModel([("shelter_code", 1)])]


class SlotResult(str, Enum):
	RESERVED = "reserved"
	JOB_FULL = "job_full"
	#: No counter yet — the worker has not projected this job. The caller decides
	#: whether to fail open; the public apply route does not.
	NOT_SEEDED = "not_seeded"


async def seed_job_slot(*, job_id: str, shelter_code: str, quota: int, now: datetime) -> None:
	"""Create or re-ceiling the counter for one job — worker projector side."""
	await VolunteerJobSlot.get_motor_collection().update_one(
		{"_id": job_id},
		{
			"$setOnInsert": {"confirmed_qty": 0, "dispatched_qty": 0, "created_at": now},
			"$set": {"shelter_code": shelter_code, "quota": quota, "updated_at": now},
		},
		upsert=True,
	)


async def reserve_job_slot(*, job_id: str, now: datetime) -> SlotResult:
	"""Take one slot iff confirmed + dispatched stays within ``quota``."""
	if await VolunteerJobSlot.get(job_id) is None:
		return SlotResult.NOT_SEEDED

	updated = await VolunteerJobSlot.get_motor_collection().find_one_and_update(
		{
			"_id": job_id,
			"$expr": {
				"$lte": [
					{
						"$add": [
							"$confirmed_qty",
							{"$ifNull": ["$dispatched_qty", 0]},
							1,
						]
					},
					"$quota",
				]
			},
		},
		{"$inc": {"confirmed_qty": 1}, "$set": {"updated_at": now}},
	)
	return SlotResult.RESERVED if updated is not None else SlotResult.JOB_FULL


async def release_job_slot(*, job_id: str, now: datetime) -> bool:
	"""Give a confirmed slot back — cancellation, or compensation for a failed write.

	Floored at zero by the filter rather than by a read: a double release must leave the
	counter alone instead of driving it negative and handing out a slot twice.
	"""
	updated = await VolunteerJobSlot.get_motor_collection().find_one_and_update(
		{"_id": job_id, "confirmed_qty": {"$gt": 0}},
		{"$inc": {"confirmed_qty": -1}, "$set": {"updated_at": now}},
	)
	return updated is not None


async def accept_dispatched_slot(*, job_id: str, now: datetime) -> bool:
	"""A dispatched offer becomes a confirmed head — CR-092 FR-VOL-06.

	🟡 → 🟢 in one update so the two counts can never be seen apart: incrementing
	``confirmed_qty`` and decrementing ``dispatched_qty`` in separate writes would, for
	an instant, show the same person twice against the quota.

	``dispatched_qty > 0`` is the filter rather than a prior read, so replaying the same
	answer cannot manufacture a confirmed head out of nothing.
	"""
	updated = await VolunteerJobSlot.get_motor_collection().find_one_and_update(
		{"_id": job_id, "dispatched_qty": {"$gt": 0}},
		{"$inc": {"confirmed_qty": 1, "dispatched_qty": -1}, "$set": {"updated_at": now}},
	)
	return updated is not None


async def decline_dispatched_slot(*, job_id: str, now: datetime) -> bool:
	"""A declined offer gives its slot back to the board — 🟡 → ⚪.

	Nothing to add: ``slots_remaining`` is derived as ``quota − confirmed − dispatched``,
	so releasing the dispatched count is what makes the seat available again.
	"""
	updated = await VolunteerJobSlot.get_motor_collection().find_one_and_update(
		{"_id": job_id, "dispatched_qty": {"$gt": 0}},
		{"$inc": {"dispatched_qty": -1}, "$set": {"updated_at": now}},
	)
	return updated is not None
