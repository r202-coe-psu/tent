"""Retention loop — remove stale Mongo projections and verify deletes."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from tent_model import (
	DonationBuffer,
	PublicDonation,
	PublicNeed,
	PublicPerson,
	PublicShelter,
	RetentionAudit,
	release_quota,
)

from worker.couch.client import CouchClient
from worker.quota.expiry import expire_declared_donations

logger = logging.getLogger(__name__)

RETENTION_INTERVAL_SECONDS = 300


def classify_expired_buffer(
	*,
	synced_to_couch: bool,
	expires_at: datetime | None,
	now: datetime,
) -> str:
	"""Return ``purge``, ``stuck``, or ``keep`` for an intake buffer row."""
	if expires_at is None:
		return "keep"
	# Motor/pymongo hands back BSON dates as timezone-naive (UTC) on read, while
	# in-process datetimes here are timezone-aware — normalize before comparing.
	if expires_at.tzinfo is None:
		expires_at = expires_at.replace(tzinfo=UTC)
	if expires_at >= now:
		return "keep"
	if synced_to_couch:
		return "purge"
	return "stuck"


async def _audit_and_delete(
	*,
	job_run_id: str,
	trigger: str,
	model: type,
	target_id: str,
	couchdb_ref: dict | None = None,
) -> None:
	audit_id = f"retention:{uuid.uuid4().hex}"
	audit = RetentionAudit(
		id=audit_id,
		job_run_id=job_run_id,
		trigger=trigger,
		target_collection=model.Settings.name,
		target_id=target_id,
		couchdb_ref=couchdb_ref,
		action="delete_one",
		status="pending",
		created_at=datetime.now(UTC),
	)
	await audit.insert()

	existing = await model.get(target_id)
	deleted_count = 0
	if existing:
		await existing.delete()
		deleted_count = 1

	remaining = await model.get(target_id)
	if remaining is None:
		audit.status = "verified"
		audit.deleted_count = deleted_count
		audit.verified_at = datetime.now(UTC)
	else:
		audit.status = "failed"
		audit.error = "Document still present after delete"
	await audit.save()


async def reconcile_closed_shelters(job_run_id: str) -> None:
	# Safety net only: CDC already deletes closed shelters from public_shelters
	# (project_shelter returns "delete"). This path cleans orphaned rows if any
	# still carry status "closed" (legacy / missed cascade).
	closed = await PublicShelter.find(PublicShelter.status == "closed").to_list()
	for shelter in closed:
		persons = await PublicPerson.find(PublicPerson.shelter_code == shelter.shelter_code).to_list()
		for person in persons:
			await _audit_and_delete(
				job_run_id=job_run_id,
				trigger="scheduled",
				model=PublicPerson,
				target_id=person.id,
				couchdb_ref={"db": "registry", "doc_id": shelter.registry_id},
			)
		needs = await PublicNeed.find(PublicNeed.shelter_code == shelter.shelter_code).to_list()
		for need in needs:
			await _audit_and_delete(
				job_run_id=job_run_id,
				trigger="scheduled",
				model=PublicNeed,
				target_id=need.id,
			)
		await _audit_and_delete(
			job_run_id=job_run_id,
			trigger="scheduled",
			model=PublicShelter,
			target_id=shelter.id,
		)


async def purge_expired_buffers(job_run_id: str) -> None:
	"""Purge expired intake buffers that already reached CouchDB.

	Never delete ``synced_to_couch=False`` rows — Mongo still owns them until
	inbound persists (sync contract). Log stuck expired-unsynced for ops.
	"""
	now = datetime.now(UTC)
	candidates = await DonationBuffer.find(
		DonationBuffer.expires_at != None,  # noqa: E711
		DonationBuffer.expires_at < now,
	).to_list()

	for donation in candidates:
		action = classify_expired_buffer(
			synced_to_couch=donation.synced_to_couch,
			expires_at=donation.expires_at,
			now=now,
		)
		if action == "stuck":
			logger.warning(
				"Skipping retention of unsynced donation buffer %s "
				"(expired %s but not yet in CouchDB)",
				donation.id,
				donation.expires_at,
			)
			continue
		if action != "purge":
			continue

		# Release reserved quota only for reservations that timed out without being
		# received or explicitly cancelled (CR-045 "TTL หมดอายุ → โควตาคืนอัตโนมัติ").
		# A "received" buffer keeps its quota consumed even after its Mongo staging
		# row ages out; a "cancelled" buffer already released via cancel() or
		# quota.settle — calling release_quota again here is a safe no-op (underflow
		# guard). This guard only works because settle keeps the status truthful:
		# before it, every synced row read "declared" forever and this branch handed
		# back quota for goods already in the shelter.
		if donation.status == "declared" and donation.campaign_id:
			for item in donation.items_declared:
				reserved_qty = item.get("reserved_qty")
				item_id = item.get("item_id")
				if reserved_qty is None or not item_id:
					continue
				await release_quota(
					shelter_code=donation.shelter_code,
					campaign_id=donation.campaign_id,
					item_id=item_id,
					qty=Decimal(reserved_qty),
					now=now,
				)

		await _audit_and_delete(
			job_run_id=job_run_id,
			trigger="scheduled",
			model=DonationBuffer,
			target_id=donation.id,
		)
		public = await PublicDonation.find_one(
			PublicDonation.tracking_token_hash == donation.tracking_token_hash
		)
		if public:
			await _audit_and_delete(
				job_run_id=job_run_id,
				trigger="scheduled",
				model=PublicDonation,
				target_id=public.id,
			)


async def run_retention_once(couch: CouchClient | None = None) -> None:
	job_run_id = uuid.uuid4().hex
	logger.info("Starting retention job %s", job_run_id)
	await reconcile_closed_shelters(job_run_id)
	await purge_expired_buffers(job_run_id)
	if couch is not None:
		# Same cycle as the quota release above so the counter and the CouchDB status
		# move together (T-21 TTL). Runs after the purge: releasing first and flipping
		# second means a crash in between leaves the doc "declared", and the next cycle
		# retries the release harmlessly thanks to the underflow guard.
		await expire_declared_donations(couch, now=datetime.now(UTC))
	logger.info("Retention job %s complete", job_run_id)


async def run_retention_loop(
	*, stop_event: asyncio.Event, couch: CouchClient | None = None
) -> None:
	while not stop_event.is_set():
		try:
			await run_retention_once(couch)
		except Exception:
			logger.exception("Retention job failed")
		await asyncio.sleep(RETENTION_INTERVAL_SECONDS)
