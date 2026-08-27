"""Donations public intake and tracking use case."""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError
from tent_model.donation_buffer import DonationBuffer, DonorBuffer
from tent_model.donation_need_counter_ops import ReserveResult, release_quota, reserve_quota
from tent_model.public_donation import DeclaredItem, PublicDonation
from tent_model.public_shelter import PublicShelter

from ...utils.masking import normalize_phone, sha256_hex
from ...utils.ulid import new_ulid
from .schemas import (
    DonationCancelResponse,
    DonationCourierPatchResponse,
    DonationCreateRequest,
    DonationCreateResponse,
    DonationItemInput,
    DonationItemsPatchResponse,
    DonationTrackingResponse,
    DonationTrackSearchResponse,
)

logger = logging.getLogger(__name__)

_MAX_BOOKING_REF_ATTEMPTS = 8

_DONATION_OPEN_STATUSES = frozenset({"open", "full", "active"})

#: Fallback for ``config:app.donation_reservation_ttl_hours`` (schema.md §3.2). The
#: singleton lives in CouchDB, which this service cannot read, so the BFF resolves it and
#: sends it on the request. This value applies only when it did not — an older BFF, or a
#: registry with no config document yet — and matches the spec default so behaviour is
#: unchanged for anyone who has not written one.
DEFAULT_RESERVATION_TTL_HOURS = 72

#: Statuses in which a donor may still change their own booking through the public token
#: routes. Only a reservation awaiting drop-off qualifies: once goods arrive the count
#: belongs to staff, and cancelled/expired have already released their quota. Mirrors
#: ``isDonorEditable`` on the BFF — CR-052's pending_review/verifying belong here too
#: once those statuses land.
DONOR_EDITABLE_STATUSES = frozenset({"declared"})


def reservation_expiry(now: datetime, ttl_hours: int | None) -> datetime:
    """When this reservation's TTL runs out (T-21 DoD — "TTL หมดอายุ → โควตาคืนอัตโนมัติ")."""
    hours = ttl_hours if ttl_hours else DEFAULT_RESERVATION_TTL_HOURS
    try:
        return now + timedelta(hours=hours)
    except OverflowError:
        # config:app is staff-authored and unbounded above; a fat-fingered value must not
        # 500 the whole booking, so fall back rather than propagate.
        logger.warning(
            "reservation_ttl_hours=%s is out of range — falling back to %sh",
            hours,
            DEFAULT_RESERVATION_TTL_HOURS,
        )
        return now + timedelta(hours=DEFAULT_RESERVATION_TTL_HOURS)


#: Where the worker lands the projected ``config:app`` (schema.md §3.2).
_PUBLIC_CONFIG_COLLECTION = "public_config"
_APP_CONFIG_ID = "config:app"


async def configured_ttl_hours() -> int | None:
    """Read ``donation_reservation_ttl_hours`` from the projected app config.

    The document lives in CouchDB, which this service cannot read, so the worker
    projects it into ``public_config`` — the same bridge CR-060 built for the quota
    ceiling. Returns ``None`` whenever the value is missing or unusable so the caller
    falls back to the spec default: a booking must never fail because config sync is
    behind, and a shelter with no config document is the normal starting state.
    """
    try:
        collection = DonationBuffer.get_motor_collection().database[_PUBLIC_CONFIG_COLLECTION]
        doc = await collection.find_one({"_id": _APP_CONFIG_ID})
    except Exception:
        logger.warning("Could not read %s — using the default TTL", _APP_CONFIG_ID, exc_info=True)
        return None
    if not doc:
        return None

    value = doc.get("donation_reservation_ttl_hours")
    # bool is an int subclass, and a stray `true` here would silently mean "1 hour".
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        if value is not None:
            logger.warning("Ignoring unusable donation_reservation_ttl_hours %r", value)
        return None
    return value


def _qty(value: Any) -> Decimal | None:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None
    return parsed if parsed > 0 else None


def _held_by_item(items_declared: list[dict[str, Any]]) -> dict[str, Decimal]:
    """What this booking currently holds in the counter, per item.

    Reads ``reserved_qty`` rather than ``qty``: they differ whenever an item bypassed
    the counter (free text, no campaign, or the counter was not seeded yet), and giving
    back quota that was never taken would hand a target out twice.
    """
    held: dict[str, Decimal] = {}
    for item in items_declared:
        item_id = item.get("item_id")
        qty = _qty(item.get("reserved_qty"))
        if item_id and qty is not None:
            held[str(item_id)] = held.get(str(item_id), Decimal(0)) + qty
    return held


def _carry_item_ids(
    items: list[DonationItemInput], held: list[dict[str, Any]]
) -> list[DonationItemInput]:
    """Re-attach the ``item_id`` this booking already holds for a line that came back bare.

    The edit form returns the whole basket, so it can only send an ``item_id`` it was
    handed. Anything upstream that loses one — a tracking stub written before the field
    existed, a stale cache, an older client — turns the edit into permanent damage: the
    item stops being quota-tracked, the counter releases what it held and never retakes
    it, and the needs board quietly stops deducting it. That is exactly what happened to
    a soap booking, twice.

    So the identity comes from this booking's own record rather than the request. This is
    not the free-text heuristic the public side rejected: nothing is inferred from
    arbitrary words, the name is only matched against the handful of lines this donation
    already has, and an unmatched line stays untracked exactly as before.

    Matching is by name because that is the only thing the form round-trips. A held line
    that carries no name at all cannot be matched and keeps the old behaviour; bookings
    made through the donate wizard always carry one.
    """
    by_name = {
        str(item.get("free_text") or item.get("item_name") or "").strip(): item.get("item_id")
        for item in held
        if item.get("item_id")
    }
    carried = []
    for item in items:
        if item.item_id or not item.free_text:
            carried.append(item)
            continue
        known = by_name.get(item.free_text.strip())
        if known:
            logger.info("Re-attached %s to an edited item that arrived without one", known)
            carried.append(item.model_copy(update={"item_id": known}))
        else:
            carried.append(item)
    return carried


def _wanted_by_item(items: list[DonationItemInput]) -> dict[str, Decimal]:
    wanted: dict[str, Decimal] = {}
    for item in items:
        qty = _qty(item.qty)
        if item.item_id and qty is not None:
            wanted[item.item_id] = wanted.get(item.item_id, Decimal(0)) + qty
    return wanted


def _revision_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The snapshot shape schema.md §2.3 stores — what the donor asked for, not bookkeeping."""
    return [
        {
            key: item[key]
            for key in ("item_id", "free_text", "qty", "unit")
            if item.get(key) is not None
        }
        for item in items
    ]


async def _undo(
    buffer: DonationBuffer, applied: list[tuple[str, Decimal]], *, now: datetime
) -> None:
    """Put every counter move from this request back, newest first."""
    if not buffer.campaign_id:
        return
    for item_id, delta in reversed(applied):
        if delta > 0:
            await release_quota(
                shelter_code=buffer.shelter_code,
                campaign_id=buffer.campaign_id,
                item_id=item_id,
                qty=delta,
                now=now,
            )
        else:
            # Re-take what was handed back. If the gap has been filled meanwhile the
            # counter refuses, which is the honest outcome: report it rather than
            # force the number back and overshoot the target.
            result = await reserve_quota(
                shelter_code=buffer.shelter_code,
                campaign_id=buffer.campaign_id,
                item_id=item_id,
                qty=-delta,
                now=now,
            )
            if result is ReserveResult.NEED_FULL:
                logger.error(
                    "Could not restore %s of %s for donation %s after a failed edit — "
                    "the counter is now short by that much; donation-quota recalculate "
                    "will settle it",
                    -delta,
                    item_id,
                    buffer.id,
                )


def _new_booking_ref() -> str:
    """Human-readable ``DN-######`` — uniqueness enforced by Mongo unique index."""
    return f"DN-{secrets.randbelow(900000) + 100000}"


def _declared_items(raw_items: list[dict[str, Any]]) -> list[DeclaredItem]:
    return [
        DeclaredItem(
            item_id=item.get("item_id"),
            item_name=str(item.get("free_text") or item.get("item_name") or ""),
            qty=item.get("qty"),
            unit=item.get("unit"),
            category=item.get("category"),
        )
        for item in raw_items
    ]


def _mask_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 4:
        return "***"
    return f"***-***-{digits[-4:]}"


def _donor_from_buffer(buffer: DonationBuffer) -> dict[str, Any]:
    """Capability-URL auth: show donor name + masked phone on the ticket only."""
    return {
        "name": buffer.donor.name,
        "phone_masked": _mask_phone(buffer.donor.phone),
        "line_id": buffer.donor.line_id,
        "email": buffer.donor.email,
    }


def _tracking_payload(
    *,
    status_value: str,
    booking_ref: str | None,
    shelter_code: str,
    items: list[DeclaredItem],
    received_summary: dict[str, Any] | None,
    updated_at: datetime,
    donor: dict[str, Any] | None = None,
    logistics: dict[str, Any] | None = None,
    expires_at: datetime | None = None,
    revisions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": status_value,
        "booking_ref": booking_ref,
        "shelter_code": shelter_code,
        "donor": donor or {},
        "items": [item.model_dump() for item in items],
        "logistics": logistics,
        "received_summary": received_summary,
        "updated_at": updated_at.isoformat(),
        "expires_at": expires_at.isoformat() if expires_at else None,
        # CR-080 — the donor's page shows how many times they have edited.
        "revisions": revisions or [],
    }
    return payload


class DonationsUseCase:
    async def create(self, payload: DonationCreateRequest) -> DonationCreateResponse:
        # Look the shelter up first, then judge its status: "no such shelter" (404) and
        # "shelter stopped taking donations" (409) are different answers for the donor,
        # and a single filtered query cannot tell them apart.
        shelter = await PublicShelter.find_one(
            PublicShelter.shelter_code == payload.shelter_code.upper()
        )
        if shelter is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "error": "SHELTER_NOT_FOUND",
                    "shelter_code": payload.shelter_code,
                },
            )
        if shelter.status not in _DONATION_OPEN_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "success": False,
                    "error": "SHELTER_CLOSED",
                    "shelter_code": payload.shelter_code,
                },
            )

        donation_id = f"donation:{new_ulid()}"
        tracking_token = f"TX-{payload.shelter_code.upper()}-{secrets.token_hex(16).upper()}"
        now = datetime.now(UTC)
        expires_at = reservation_expiry(now, await configured_ttl_hours())
        token_hash = sha256_hex(tracking_token)

        items_declared = [item.model_dump(exclude_none=True) for item in payload.items]
        declared = _declared_items(items_declared)

        # Atomic quota reservation (CR-045/T-21) — only items with both campaign_id +
        # item_id are quota-tracked; free-text/no-campaign items bypass unchanged.
        # reserved[] accumulates successful increments so a later NEED_FULL (or a
        # buffer-insert failure below) can compensate them — no multi-doc transaction
        # available on single-node Mongo, so rollback is manual (CR-045 Compensation).
        reserved: list[tuple[str, str, Decimal]] = []
        try:
            for idx, item in enumerate(payload.items):
                if not payload.campaign_id or not item.item_id:
                    continue
                try:
                    qty = Decimal(str(item.qty))
                except InvalidOperation:
                    continue

                result = await reserve_quota(
                    shelter_code=payload.shelter_code.upper(),
                    campaign_id=payload.campaign_id,
                    item_id=item.item_id,
                    qty=qty,
                    now=now,
                )
                if result is ReserveResult.NEED_FULL:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "success": False,
                            "error": "NEED_FULL",
                            "item_id": item.item_id,
                        },
                    )
                if result is ReserveResult.NOT_SEEDED:
                    logger.warning(
                        "donation_need_counter not seeded for %s/%s/%s — allowing "
                        "unreserved (CR-048 worker projector not caught up yet)",
                        payload.shelter_code.upper(),
                        payload.campaign_id,
                        item.item_id,
                    )
                    continue

                reserved.append((payload.campaign_id, item.item_id, qty))
                items_declared[idx]["reserved_qty"] = str(qty)

            buffer: DonationBuffer | None = None
            booking_ref = ""
            for attempt in range(_MAX_BOOKING_REF_ATTEMPTS):
                booking_ref = _new_booking_ref()
                candidate = DonationBuffer(
                    id=donation_id,
                    shelter_code=payload.shelter_code.upper(),
                    donor=DonorBuffer(**payload.donor.model_dump()),
                    items_declared=items_declared,
                    logistics=payload.logistics,
                    campaign_id=payload.campaign_id,
                    booking_ref=booking_ref,
                    tracking_token=tracking_token,
                    tracking_token_hash=token_hash,
                    status="declared",
                    synced_to_couch=False,
                    created_at=now,
                    expires_at=expires_at,
                )
                try:
                    await candidate.insert()
                    buffer = candidate
                    break
                except DuplicateKeyError:
                    # Unique index on booking_ref (and tracking_token_hash). New token each
                    # call — practically only booking_ref collisions need a retry.
                    if attempt < _MAX_BOOKING_REF_ATTEMPTS - 1:
                        continue
                    raise

            if buffer is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail={"success": False, "error": "BOOKING_REF_EXHAUSTED"},
                )
        except Exception:
            for campaign_id, item_id, qty in reserved:
                await release_quota(
                    shelter_code=payload.shelter_code.upper(),
                    campaign_id=campaign_id,
                    item_id=item_id,
                    qty=qty,
                    now=now,
                )
            raise

        # Stub public_donations so GET tracking works before outbound CDC catches up.
        stub = PublicDonation(
            id=donation_id,
            tracking_token_hash=token_hash,
            shelter_code=payload.shelter_code.upper(),
            status="declared",
            booking_ref=booking_ref,
            items_declared=declared,
            received_summary=None,
            updated_at=now,
        )
        await stub.insert()

        return DonationCreateResponse(
            tracking_token=tracking_token,
            booking_ref=booking_ref,
        )

    async def get_by_tracking_token(self, tracking_token: str) -> DonationTrackingResponse:
        token_hash = sha256_hex(tracking_token)
        # Buffer may still hold logistics + donor after the public stub exists;
        # enrich the ticket when available (retention may drop the buffer later).
        buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
        donation = await PublicDonation.find_one(PublicDonation.tracking_token_hash == token_hash)

        if donation is not None:
            return DonationTrackingResponse(
                donation=_tracking_payload(
                    status_value=donation.status,
                    booking_ref=donation.booking_ref,
                    shelter_code=donation.shelter_code,
                    items=list(donation.items_declared),
                    received_summary=donation.received_summary,
                    updated_at=donation.updated_at,
                    donor=_donor_from_buffer(buffer) if buffer else {},
                    logistics=dict(buffer.logistics) if buffer and buffer.logistics else None,
                    expires_at=buffer.expires_at if buffer else None,
                    revisions=list(buffer.revisions) if buffer else [],
                )
            )

        if buffer is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Donation record not found"},
            )

        return DonationTrackingResponse(
            donation=_tracking_payload(
                status_value=buffer.status,
                booking_ref=buffer.booking_ref,
                shelter_code=buffer.shelter_code,
                items=_declared_items(buffer.items_declared),
                received_summary=None,
                updated_at=buffer.created_at,
                donor=_donor_from_buffer(buffer),
                logistics=dict(buffer.logistics) if buffer.logistics else None,
                expires_at=buffer.expires_at,
                revisions=list(buffer.revisions),
            )
        )

    async def track_search(self, booking_ref: str, phone: str) -> DonationTrackSearchResponse:
        """Resolve ``DN-######`` + phone → tracking_token (CR-052 §2.6).

        Always 404 on miss / phone mismatch so booking refs are not enumerable.
        """
        ref = booking_ref.strip().upper()
        if not ref.startswith("DN-"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Donation record not found"},
            )

        buffer = await DonationBuffer.find_one(DonationBuffer.booking_ref == ref)
        if buffer is None:
            buffer = await DonationBuffer.find_one(
                DonationBuffer.booking_ref == booking_ref.strip()
            )
        if buffer is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Donation record not found"},
            )

        if normalize_phone(buffer.donor.phone) != normalize_phone(phone):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Donation record not found"},
            )

        return DonationTrackSearchResponse(
            tracking_token=buffer.tracking_token,
            booking_ref=buffer.booking_ref,
        )

    async def update_courier_tracking(
        self, tracking_token: str, courier_tracking_no: str
    ) -> DonationCourierPatchResponse:
        """Update courier tracking on the intake buffer before inbound persists to Couch.

        Once ``synced_to_couch`` is true the SoR is CouchDB — callers should PATCH via
        the SvelteKit BFF Couch path (or retry shortly after inbound).
        """
        token_hash = sha256_hex(tracking_token)
        buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
        if buffer is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Donation record not found"},
            )

        if buffer.synced_to_couch:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "success": False,
                    "error": "SYNCED_TO_COUCH",
                    "message": "Donation already in CouchDB; update via shelter record",
                },
            )

        if buffer.status not in DONOR_EDITABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": f'Cannot update a donation in status "{buffer.status}"',
                },
            )

        logistics = dict(buffer.logistics or {})
        if logistics.get("delivery_method") != "parcel":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": "Courier tracking number can only be updated for parcel deliveries",
                },
            )

        logistics["courier_tracking_no"] = courier_tracking_no
        buffer.logistics = logistics
        await buffer.save()
        return DonationCourierPatchResponse()

    async def update_items(
        self, tracking_token: str, items: list[DonationItemInput]
    ) -> DonationItemsPatchResponse:
        """Replace the donor's declared items, moving the quota by the difference.

        CR-080. ``items`` is the whole basket the donor wants, not a delta — dropping a
        line means leaving it out. The counter moves by the difference against what this
        booking already holds, so editing 5 kg to 8 kg reserves 3, not 8.

        Releases run before reserves. Moving quantity from one item to another otherwise
        collides with the booking's own reservation and is refused for no reason.

        The whole request is refused if any reserve comes back full (CR-080 Q2): every
        increment already applied in this call is handed back, and the donation is left
        exactly as it was. Single-node Mongo has no multi-document transaction, so that
        rollback is manual — the same compensation ``create`` does.

        ``expires_at`` is untouched (CR-080 Q3): the TTL runs from the original
        ``declared_at``, or a donor could hold a reservation open forever by editing it.
        """
        token_hash = sha256_hex(tracking_token)
        buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
        if buffer is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Donation record not found"},
            )
        if buffer.status not in DONOR_EDITABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": f'Cannot edit a donation in status "{buffer.status}"',
                },
            )
        if not items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"success": False, "error": "A donation needs at least one item"},
            )

        now = datetime.now(UTC)
        before = [dict(item) for item in buffer.items_declared]
        items = _carry_item_ids(items, before)
        held = _held_by_item(before)
        wanted = _wanted_by_item(items)

        # Applied so far in this call, so a later refusal can undo exactly these.
        applied: list[tuple[str, Decimal]] = []
        try:
            if buffer.campaign_id:
                for item_id in sorted(set(held) | set(wanted)):
                    delta = wanted.get(item_id, Decimal(0)) - held.get(item_id, Decimal(0))
                    if delta >= 0:
                        continue
                    await release_quota(
                        shelter_code=buffer.shelter_code,
                        campaign_id=buffer.campaign_id,
                        item_id=item_id,
                        qty=-delta,
                        now=now,
                    )
                    applied.append((item_id, delta))

                for item_id in sorted(set(held) | set(wanted)):
                    delta = wanted.get(item_id, Decimal(0)) - held.get(item_id, Decimal(0))
                    if delta <= 0:
                        continue
                    result = await reserve_quota(
                        shelter_code=buffer.shelter_code,
                        campaign_id=buffer.campaign_id,
                        item_id=item_id,
                        qty=delta,
                        now=now,
                    )
                    if result is ReserveResult.NEED_FULL:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail={"success": False, "error": "NEED_FULL", "item_id": item_id},
                        )
                    if result is ReserveResult.NOT_SEEDED:
                        logger.warning(
                            "donation_need_counter not seeded for %s/%s/%s — editing unreserved",
                            buffer.shelter_code,
                            buffer.campaign_id,
                            item_id,
                        )
                        continue
                    applied.append((item_id, delta))
        except HTTPException:
            await _undo(buffer, applied, now=now)
            raise
        except Exception:
            await _undo(buffer, applied, now=now)
            logger.exception("Failed to move quota while editing donation %s", buffer.id)
            raise

        after = [item.model_dump(exclude_none=True) for item in items]
        for row in after:
            item_id = row.get("item_id")
            if item_id and item_id in wanted and buffer.campaign_id:
                row["reserved_qty"] = str(wanted[item_id])

        revision = {
            "at": now.isoformat(),
            "by": "donor",
            "items_before": _revision_items(before),
            "items_after": _revision_items(after),
        }
        buffer.items_declared = after
        buffer.revisions = [*buffer.revisions, revision]
        await buffer.save()

        # Keep the tracking stub in step so the donor's page shows the edit at once,
        # rather than waiting for inbound and CDC to come round.
        stub = await PublicDonation.find_one(PublicDonation.tracking_token_hash == token_hash)
        if stub is not None:
            stub.items_declared = _declared_items(after)
            stub.updated_at = now
            await stub.save()

        return DonationItemsPatchResponse(
            revisions=len(buffer.revisions), items=after, revision=revision
        )

    async def cancel(self, tracking_token: str) -> DonationCancelResponse:
        """Cancel on the Mongo intake buffer before inbound persists it to Couch.

        Once ``synced_to_couch`` is true the SoR is CouchDB — callers should DELETE via
        the SvelteKit BFF Couch path instead.
        """
        token_hash = sha256_hex(tracking_token)
        buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
        if buffer is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Donation record not found"},
            )

        if buffer.synced_to_couch:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "success": False,
                    "error": "SYNCED_TO_COUCH",
                    "message": "Donation already in CouchDB; cancel via shelter record",
                },
            )

        if buffer.status not in DONOR_EDITABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "error": f'Cannot cancel donation in status "{buffer.status}"',
                },
            )

        buffer.status = "cancelled"
        await buffer.save()

        # Release quota for whatever was actually reserved per item (CR-045) — no-op
        # (underflow-guarded) for items that bypassed the counter (no "reserved_qty").
        if buffer.campaign_id:
            release_now = datetime.now(UTC)
            for item in buffer.items_declared:
                reserved_qty = item.get("reserved_qty")
                item_id = item.get("item_id")
                if reserved_qty is None or not item_id:
                    continue
                await release_quota(
                    shelter_code=buffer.shelter_code,
                    campaign_id=buffer.campaign_id,
                    item_id=item_id,
                    qty=Decimal(reserved_qty),
                    now=release_now,
                )

        # Keep the tracking stub in step so GET reflects the cancellation immediately,
        # instead of waiting for outbound CDC sync to catch up.
        stub = await PublicDonation.find_one(PublicDonation.tracking_token_hash == token_hash)
        if stub is not None:
            stub.status = "cancelled"
            await stub.save()

        return DonationCancelResponse()


def get_donations_use_case() -> DonationsUseCase:
    return DonationsUseCase()
