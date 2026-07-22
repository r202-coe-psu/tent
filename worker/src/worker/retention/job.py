"""Retention loop — remove stale Mongo projections and verify deletes."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from tent_model import (
	DonationBuffer,
	PublicDonation,
	PublicNeed,
	PublicPerson,
	PublicShelter,
	RetentionAudit,
)

logger = logging.getLogger(__name__)

RETENTION_INTERVAL_SECONDS = 300


def classify_expired_buffer(
	*,
	synced_to_couch: bool,
	expires_at: datetime | None,
	now: datetime,
) -> str:
	"""Return ``purge``, ``stuck``, or ``keep`` for an intake buffer row."""
	if expires_at is None or expires_at >= now:
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


async def run_retention_once() -> None:
	job_run_id = uuid.uuid4().hex
	logger.info("Starting retention job %s", job_run_id)
	await reconcile_closed_shelters(job_run_id)
	await purge_expired_buffers(job_run_id)
	logger.info("Retention job %s complete", job_run_id)


async def run_retention_loop(*, stop_event: asyncio.Event) -> None:
	while not stop_event.is_set():
		try:
			await run_retention_once()
		except Exception:
			logger.exception("Retention job failed")
		await asyncio.sleep(RETENTION_INTERVAL_SECONDS)
