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
    PublicPerson,
    PublicShelter,
    release_quota,
    release_slot,
)

from worker.couch.bootstrap import read_retention_months
from worker.couch.client import CouchClient
from worker.donation_status import is_donation_outstanding
from worker.mongo import delete_closed_shelter_operations
from worker.projectors.shelter import (
    DEFAULT_RETENTION_MONTHS_AFTER_CLOSE,
    RetentionPhase,
    classify_retention,
)
from worker.quota.expiry import expire_declared_donations
from worker.retention.audit import audit_and_delete

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


async def reconcile_closed_shelters(
    job_run_id: str, *, retention_months: int, now: datetime
) -> None:
    """Apply the closed-shelter retention rule (CR-183, data-model §7).

    The ``public_shelters`` row is kept for good (FR-1). Needs, stocks and occupants go
    as soon as the shelter is closed; the processor already drops them on the closing
    change, this is the safety net (FR-4). ``public_persons`` stay searchable until
    ``closed_at`` + ``retention_months`` and are then deleted one by one with an audit
    row (FR-2, FR-3). ``closed_at`` comes from the projected row only (FR-5).
    """
    closed = await PublicShelter.find(PublicShelter.status == "closed").to_list()
    for shelter in closed:
        code = shelter.shelter_code
        await delete_closed_shelter_operations(
            code, trigger="scheduled", job_run_id=job_run_id
        )
        phase = classify_retention(
            status=shelter.status,
            closed_at=shelter.closed_at,
            retention_months=retention_months,
            now=now,
        )
        if phase is RetentionPhase.CLOSED_WITHOUT_DATE:
            logger.warning(
                "Closed shelter %s has no closed_at — keeping its public_persons "
                "(CR-183 D-5); backfill with migrate:shelter-closed-at",
                code,
            )
            continue
        if phase is not RetentionPhase.CLOSED_EXPIRED:
            continue
        persons = await PublicPerson.find(PublicPerson.shelter_code == code).to_list()
        for person in persons:
            await audit_and_delete(
                job_run_id=job_run_id,
                trigger="scheduled",
                model=PublicPerson,
                target_id=person.id,
                couchdb_ref={"db": "registry", "doc_id": shelter.registry_id},
            )


async def purge_expired_buffers(job_run_id: str) -> None:
    """Purge expired intake buffers that already reached CouchDB.

    Never delete ``synced_to_couch=False`` rows — Mongo still owns them until
    inbound persists (sync contract). Log stuck expired-unsynced for ops.
    """
    now = datetime.now(UTC)
    candidates = await DonationBuffer.find(
        DonationBuffer.expires_at != None,
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
        # back quota for goods already in the shelter. Since CR-052 a booking waits in
        # "pending_review"/"verifying" rather than "declared", so the test is the whole
        # outstanding set — otherwise a purged reservation keeps its quota forever.
        if is_donation_outstanding(donation.status) and donation.campaign_id:
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
        # The queue place times out with the reservation — a window does not stay full
        # for a donor who never came. Not nested under `campaign_id`: a booking with no
        # campaign item still takes a place in a capped window.
        if is_donation_outstanding(donation.status) and donation.slot_counter_id:
            await release_slot(counter_id=donation.slot_counter_id, now=now)

        await audit_and_delete(
            job_run_id=job_run_id,
            trigger="scheduled",
            model=DonationBuffer,
            target_id=donation.id,
        )
        public = await PublicDonation.find_one(
            PublicDonation.tracking_token_hash == donation.tracking_token_hash
        )
        if public:
            await audit_and_delete(
                job_run_id=job_run_id,
                trigger="scheduled",
                model=PublicDonation,
                target_id=public.id,
            )


async def run_retention_once(couch: CouchClient | None = None) -> None:
    job_run_id = uuid.uuid4().hex
    logger.info("Starting retention job %s", job_run_id)
    retention_months = (
        await read_retention_months(couch)
        if couch is not None
        else DEFAULT_RETENTION_MONTHS_AFTER_CLOSE
    )
    await reconcile_closed_shelters(
        job_run_id, retention_months=retention_months, now=datetime.now(UTC)
    )
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
