"""Idempotency keys for partner booking create (EXT-008, #614; CR-169 decision sync 2026-10-17).

One row per `Idempotency-Key` a partner client sent with `POST /external/bookings`. The row
holds only a hash of the canonical request (no CID, name or phone), the `booking_id` it
produced and a status, so a retry can get the original answer back. Rows expire 24 h after
`created_at` (TTL index); a failed first attempt deletes its row so a retry can proceed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel

IdempotencyStatus = Literal["in_progress", "completed"]

# Spec: a key is kept for 24 hours after the first request.
IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60


class ExternalBookingIdempotency(Document):
	model_config = ConfigDict(populate_by_name=True)

	# `_id`: `IK-{ulid}`
	id: str = Field(alias="_id")
	client_id: str
	# Client-supplied `Idempotency-Key` (1..255 characters); unique per client_id
	key: str
	# sha256 of the canonical, normalized request (location_code + persons). The CID inside is
	# replaced by its keyed `national_id_hash` before hashing, so the raw CID is never hashed.
	request_hash: str
	# `BK-{ulid}` created by the first request; reserved (set) while in_progress as well
	booking_id: str
	status: IdempotencyStatus = "in_progress"
	created_at: datetime

	class Settings:
		name = "external_booking_idempotency"
		indexes = [
			IndexModel(
				[("client_id", 1), ("key", 1)],
				unique=True,
				name="uniq_idempotency_key_per_client",
			),
			IndexModel(
				[("created_at", 1)],
				expireAfterSeconds=IDEMPOTENCY_TTL_SECONDS,
				name="ttl_idempotency_created_at",
			),
		]
