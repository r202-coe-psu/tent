"""Shared atomic quota operations on ``donation_need_counter`` (CR-045 / CR-048).

Both FastAPI (``backend/apiapp/modules/donations``) and the worker retention job
(``worker/src/worker/retention/job.py``) call these instead of hand-rolling their own
``$inc``/`$expr` queries, so the increment/decrement invariants stay in one place.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum

import bson

from tent_model.donation_need_counter import DonationNeedCounter


def counter_id(shelter_code: str, campaign_id: str, item_id: str) -> str:
	return f"{shelter_code}:{campaign_id}:{item_id}"


async def seed_counter(
	*,
	shelter_code: str,
	campaign_id: str,
	item_id: str,
	qty_target: Decimal,
	now: datetime,
) -> bool:
	"""Create the counter for one campaign need if absent — worker side of CR-060.

	Writes only the fields the worker owns (CR-060 FR-3). ``reserved_qty`` is seeded to 0
	on insert and never touched again, so a concurrent FastAPI ``$inc`` can't be clobbered.

	``qty_target`` uses ``$setOnInsert`` (FR-2): editing the campaign later does NOT move
	the counter's ceiling — only the DR recalculation tool may. Because of that, replaying
	the same CDC change (worker restart from an older checkpoint) is a no-op by
	construction, so no dedup bookkeeping is needed on the caller side.

	Returns ``True`` when this call actually created the doc.

	NOTE deliberately NOT via ``worker.mongo.upsert.apply_document``: that helper does
	read → ``setattr`` every field → ``save()``, which rewrites the whole document and
	would wipe ``reserved_qty``.
	"""
	result = await DonationNeedCounter.get_motor_collection().update_one(
		{"_id": counter_id(shelter_code, campaign_id, item_id)},
		{
			"$setOnInsert": {
				"shelter_code": shelter_code,
				"campaign_id": campaign_id,
				"item_id": item_id,
				"qty_target": bson.Decimal128(str(qty_target)),
				"reserved_qty": bson.Decimal128("0"),
				"created_at": now,
			},
			"$set": {"updated_at": now},
		},
		upsert=True,
	)
	return result.upserted_id is not None


class ReserveResult(str, Enum):
	RESERVED = "reserved"
	NEED_FULL = "need_full"
	# no counter doc exists yet for this key (worker hasn't projected the campaign
	# need — CR-048 not deployed/caught up yet); caller decides fail-open vs. reject
	NOT_SEEDED = "not_seeded"


async def reserve_quota(
	*, shelter_code: str, campaign_id: str, item_id: str, qty: Decimal, now: datetime
) -> ReserveResult:
	"""Atomically increment ``reserved_qty`` iff ``reserved_qty + qty <= qty_target``."""
	cid = counter_id(shelter_code, campaign_id, item_id)
	existing = await DonationNeedCounter.get(cid)
	if existing is None:
		return ReserveResult.NOT_SEEDED

	updated = await DonationNeedCounter.get_motor_collection().find_one_and_update(
		{
			"_id": cid,
			"$expr": {
				"$lte": [
					{"$add": ["$reserved_qty", bson.Decimal128(str(qty))]},
					"$qty_target",
				]
			},
		},
		{"$inc": {"reserved_qty": bson.Decimal128(str(qty))}, "$set": {"updated_at": now}},
	)
	return ReserveResult.RESERVED if updated is not None else ReserveResult.NEED_FULL


async def set_reserved_qty(
	*,
	shelter_code: str,
	campaign_id: str,
	item_id: str,
	expected: bson.Decimal128,
	new_value: Decimal,
	now: datetime,
) -> bool:
	"""Overwrite ``reserved_qty`` — recalculation path only (CR-047 §DR tool).

	``expected`` is the exact ``Decimal128`` read a moment ago and is part of the filter:
	if any ``$inc`` from FastAPI landed in between, the update matches nothing and this
	returns ``False``. That is the Cutover-Lock guard — a recalculation that raced a live
	booking must be reported and retried in a maintenance window, never applied blindly.

	The only writer of ``reserved_qty`` besides ``reserve_quota``/``release_quota``. Do
	not add a third; keep every mutation of this field in this module (CR-047 §DRY).
	"""
	updated = await DonationNeedCounter.get_motor_collection().find_one_and_update(
		{
			"_id": counter_id(shelter_code, campaign_id, item_id),
			"reserved_qty": expected,
		},
		{
			"$set": {
				"reserved_qty": bson.Decimal128(str(new_value)),
				"last_recalculated_at": now,
				"updated_at": now,
			}
		},
	)
	return updated is not None


async def release_quota(
	*, shelter_code: str, campaign_id: str, item_id: str, qty: Decimal, now: datetime
) -> None:
	"""Underflow-guarded decrement — no-op if less than ``qty`` remains reserved.

	Not an error: a duplicate cancel/expire (same buffer processed twice concurrently)
	means an earlier call already released this amount. "ลดได้ไม่เกินเท่าที่มี" — never
	drive ``reserved_qty`` below 0.
	"""
	cid = counter_id(shelter_code, campaign_id, item_id)
	await DonationNeedCounter.get_motor_collection().find_one_and_update(
		{"_id": cid, "reserved_qty": {"$gte": bson.Decimal128(str(qty))}},
		{"$inc": {"reserved_qty": bson.Decimal128(str(-qty))}, "$set": {"updated_at": now}},
	)
