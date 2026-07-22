"""Inbound loop — persist public donation buffer docs into CouchDB."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from tent_model import DonationBuffer

from worker.couch.client import CouchClient
from worker.masking import sha256_hex, shelter_db_name

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 15


async def _persist_donation(couch: CouchClient, donation: DonationBuffer) -> bool:
    database = shelter_db_name(donation.shelter_code)
    if not await couch.database_exists(database):
        logger.warning("Shelter database %s missing for donation %s", database, donation.id)
        return False

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    couch_doc = {
        "_id": donation.id if donation.id.startswith("donation:") else f"donation:{donation.id}",
        "type": "donation",
        "schema_v": 2,
        "channel": "public",
        "shelter_code": donation.shelter_code,
        "campaign_id": donation.campaign_id,
        "created_at": donation.created_at.isoformat().replace("+00:00", "Z"),
        "updated_at": now,
        "declared_at": donation.created_at.isoformat().replace("+00:00", "Z"),
        "expires_at": (
            donation.expires_at.isoformat().replace("+00:00", "Z") if donation.expires_at else None
        ),
        "created_by": "public",
        "booking_ref": donation.booking_ref,
        "tracking_token_hash": donation.tracking_token_hash,
        "kind": "items",
        "donor": {
            "name": donation.donor.name,
            "phone": donation.donor.phone,
            "phone_hash": sha256_hex(donation.donor.phone),
            "line_id": donation.donor.line_id,
            "email": donation.donor.email,
        },
        "items": donation.items_declared,
        "logistics": donation.logistics,
        "status": donation.status,
        "source": "public",
    }

    try:
        result = await couch.put_doc(database, couch_doc)
    except Exception:
        logger.exception("Failed to persist donation %s to CouchDB", donation.id)
        return False

    if not result.get("ok"):
        logger.error(
            "CouchDB put for donation %s did not acknowledge ok: %s",
            donation.id,
            result,
        )
        return False

    donation.synced_to_couch = True
    await donation.save()
    logger.info("Persisted donation %s to %s", donation.id, database)
    return True


async def run_inbound_loop(couch: CouchClient, *, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            pending = await DonationBuffer.find(
                DonationBuffer.synced_to_couch == False  # noqa: E712
            ).to_list()
            for donation in pending:
                if stop_event.is_set():
                    break
                await _persist_donation(couch, donation)
        except Exception:
            logger.exception("Inbound donation poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
