"""Donations public intake and tracking use case."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError
from tent_model.donation_buffer import DonationBuffer, DonorBuffer
from tent_model.public_donation import DeclaredItem, PublicDonation
from tent_model.public_shelter import PublicShelter

from ...utils.masking import normalize_phone, sha256_hex
from ...utils.ulid import new_ulid
from .schemas import (
    DonationCourierPatchResponse,
    DonationCreateRequest,
    DonationCreateResponse,
    DonationTrackSearchResponse,
    DonationTrackingResponse,
)

_MAX_BOOKING_REF_ATTEMPTS = 8

_DONATION_OPEN_STATUSES = frozenset({"open", "full", "active"})


def _new_booking_ref() -> str:
    """Human-readable ``DN-######`` — uniqueness enforced by Mongo unique index."""
    return f"DN-{secrets.randbelow(900000) + 100000}"


def _declared_items(raw_items: list[dict[str, Any]]) -> list[DeclaredItem]:
    return [
        DeclaredItem(
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
        expires_at = now + timedelta(hours=72)
        token_hash = sha256_hex(tracking_token)

        items_declared = [item.model_dump(exclude_none=True) for item in payload.items]
        declared = _declared_items(items_declared)

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
            buffer = await DonationBuffer.find_one(DonationBuffer.booking_ref == booking_ref.strip())
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


def get_donations_use_case() -> DonationsUseCase:
    return DonationsUseCase()
