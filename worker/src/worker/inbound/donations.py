"""Inbound loop — persist public donation buffer docs into CouchDB."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import UTC, datetime
from typing import Any

from tent_model import DonationBuffer

from worker.couch.client import CouchClient
from worker.masking import phone_hash, shelter_db_name
from worker.timeutil import iso_utc

logger = logging.getLogger(__name__)

#: How long a public booking can sit in Mongo before CouchDB — and therefore the needs
#: board and the booking pre-check, which both read CouchDB — knows about it.
#:
#: That lag is the window two donors can book the same last units in: each reads a state
#: where the other's booking has not landed. The atomic counter is the backstop, but it
#: only enforces ``reserved_qty ≤ qty_target`` and knows nothing about warehouse stock,
#: so a shelter already holding goods can still be over-collected inside the window.
#: Closing that properly means giving the counter a stock-aware ceiling; until then a
#: shorter poll is what keeps the exposure small. Three seconds costs one extra indexed
#: Mongo query per second across all shelters.
POLL_INTERVAL_SECONDS = 3

#: ``donation`` schema_v this writer stamps. Keep in step with the walk-in writer in the
#: frontend — both channels write the same shape (schema.md §2.3).
DONATION_SCHEMA_V = 8

_AUDIT_SCHEMA_V = 1
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def campaign_auto_approve_audit_id(donation_id: str) -> str:
    """Fixed ``audit:{26 Crockford chars}`` id of a booking's campaign auto-approval.

    Inbound can run the same buffer row more than once (a CouchDB write that succeeds
    while the Mongo ``synced_to_couch`` flag does not), so the audit id is derived from
    the donation rather than minted: a second run hits the same id and CouchDB refuses
    it. SHA-256 of ``"{donation_id}:campaign_auto_approve"``, first 130 bits as Crockford
    base32 — the encoding ``deriveDeterministicLedgerId`` uses in the frontend.
    """
    digest = hashlib.sha256(f"{donation_id}:campaign_auto_approve".encode()).digest()
    value = int.from_bytes(digest, "big") >> (256 - 130)
    chars = [_CROCKFORD[(value >> (5 * (25 - i))) & 31] for i in range(26)]
    return "audit:" + "".join(chars)


def auto_approved_lines(items: list[dict[str, Any]]) -> list[int]:
    """Index of every line FastAPI approved by the campaign rule (CR-174 FR-2).

    Before a booking reaches CouchDB no person can have reviewed it, so every approved
    line in the buffer was approved by the system.
    """
    return [
        index
        for index, item in enumerate(items)
        if isinstance(item, dict) and item.get("review_status") == "approved"
    ]


def build_auto_approve_audit(
    *,
    donation_id: str,
    shelter_code: str,
    booking_ref: str | None,
    lines: list[int],
    now: str,
) -> dict[str, Any]:
    """The ``audit`` of a campaign auto-approval (CR-174 FR-26).

    Same envelope as the staff app's ``createAuditEntry``. ``manual_adjust`` because the
    ``audit.action`` enum (schema.md §2.12) has no approval value and staff approvals
    already use it; ``context.approved_by: 'system'`` is what tells the two apart.
    """
    return {
        "_id": campaign_auto_approve_audit_id(donation_id),
        "type": "audit",
        "schema_v": _AUDIT_SCHEMA_V,
        "shelter_code": shelter_code,
        "created_at": now,
        "updated_at": now,
        "created_by": "system",
        "action": "manual_adjust",
        "target_type": "donation",
        "target_id": donation_id,
        "reason": (f"อนุมัติอัตโนมัติ — รายการอยู่ในแคมเปญ ({booking_ref or donation_id})"),
        "context": {
            "approved_by": "system",
            "rule": "campaign_line",
            "lines": lines,
            "booking_ref": booking_ref,
        },
        "occurred_at": now,
    }


async def _write_auto_approve_audit(
    couch: CouchClient, database: str, audit: dict[str, Any]
) -> None:
    """Create the audit once, logging a failure. A ``conflict`` means it already exists."""
    try:
        rows = await couch.bulk_docs(database, [audit])
    except Exception:
        logger.exception("Failed to write auto-approve audit %s", audit["_id"])
        return
    for row in rows:
        error = row.get("error")
        if error and error != "conflict":
            logger.error("CouchDB refused auto-approve audit %s: %s", audit["_id"], row)


async def _persist_donation(couch: CouchClient, donation: DonationBuffer) -> bool:
    database = shelter_db_name(donation.shelter_code)
    if not await couch.database_exists(database):
        logger.warning(
            "Shelter database %s missing for donation %s", database, donation.id
        )
        return False

    now = iso_utc(datetime.now(UTC))
    doc_id = (
        donation.id
        if donation.id.startswith("donation:")
        else f"donation:{donation.id}"
    )

    couch_doc = {
        "_id": doc_id,
        "type": "donation",
        # 8 for logistics.vehicle_plate (draft-donation-vehicle-plate) — copied with `logistics`, below.
        # 7 for items[].review_status / review_reason_code / review_reason (CR-174) —
        # FastAPI sets review_status on every line, and the lines are copied whole below.
        # 6 was reject_reason / reject_reason_code + received_summary.items[].rejected
        # (CR-172); 5 was redirect_to_shelter_code (CR-087); 4 was revisions[] (CR-080).
        # This line read 2 until CR-080, two versions behind: CR-038 moved items[].qty to
        # qty_str and took schema.md §2.3 to 3, but only the walk-in writer followed, so
        # every public donation was stamped a version it had already outgrown. Keep both
        # writers in step.
        "schema_v": DONATION_SCHEMA_V,
        "channel": "public",
        "shelter_code": donation.shelter_code,
        "campaign_id": donation.campaign_id,
        # Mongo hands these back naive (UTC without an offset) — see `iso_utc`.
        "created_at": iso_utc(donation.created_at),
        "updated_at": now,
        "declared_at": iso_utc(donation.created_at),
        "expires_at": iso_utc(donation.expires_at) if donation.expires_at else None,
        "created_by": "public",
        "booking_ref": donation.booking_ref,
        "tracking_token_hash": donation.tracking_token_hash,
        "kind": "items",
        "donor": {
            "name": donation.donor.name,
            "phone": donation.donor.phone,
            # Of the normalized number (CR-173 FR-13), as the backend hashes it —
            # `081-234-5678` and `+66812345678` must land on the same hash.
            "phone_hash": phone_hash(donation.donor.phone),
            "line_id": donation.donor.line_id,
            "email": donation.donor.email,
        },
        # Whole, so items[].review_* (CR-174) arrive as FastAPI wrote them.
        "items": donation.items_declared,
        "logistics": donation.logistics,
        # Read off the lines by FastAPI (CR-174 FR-4..FR-6), not a fixed initial value.
        "status": donation.status,
        # Donor edits made before this reached CouchDB (CR-080) — carry the log across
        # so the shelter sees the full history, not just the final shape.
        "revisions": donation.revisions,
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

    # CR-174 FR-26: record the lines the campaign rule approved, from the same lines just
    # written. After the donation, not before: an audit ahead of a failed PUT named lines
    # the donor could still change, and the next poll's copy hit the fixed id and was
    # dropped. A failure here is logged and the row still counts as synced — the donation
    # is in CouchDB, so a re-run could not PUT it again.
    lines = auto_approved_lines(list(donation.items_declared))
    if lines:
        audit = build_auto_approve_audit(
            donation_id=doc_id,
            shelter_code=donation.shelter_code,
            booking_ref=donation.booking_ref,
            lines=lines,
            now=now,
        )
        await _write_auto_approve_audit(couch, database, audit)

    donation.synced_to_couch = True
    await donation.save()
    logger.info("Persisted donation %s to %s", donation.id, database)
    return True


async def run_inbound_loop(couch: CouchClient, *, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            pending = await DonationBuffer.find(
                DonationBuffer.synced_to_couch == False
            ).to_list()
            for donation in pending:
                if stop_event.is_set():
                    break
                await _persist_donation(couch, donation)
        except Exception:
            logger.exception("Inbound donation poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
