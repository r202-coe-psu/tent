"""Donations public intake and tracking use case."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from tent_model.donation_buffer import DonationBuffer, DonorBuffer
from tent_model.public_donation import DeclaredItem, PublicDonation
from tent_model.public_shelter import PublicShelter

from ...utils.masking import sha256_hex
from ...utils.ulid import new_ulid
from .schemas import (
    DonationCourierPatchResponse,
    DonationCreateRequest,
    DonationCreateResponse,
    DonationTrackingResponse,
)


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


def _tracking_payload(
    *,
    status_value: str,
    booking_ref: str | None,
    shelter_code: str,
    items: list[DeclaredItem],
    received_summary: dict[str, Any] | None,
    updated_at: datetime,
) -> dict[str, Any]:
    return {
        "status": status_value,
        "booking_ref": booking_ref,
        "shelter_code": shelter_code,
        "donor": {},
        "items": [item.model_dump() for item in items],
        "received_summary": received_summary,
        "updated_at": updated_at.isoformat(),
    }


class DonationsUseCase:
    async def create(self, payload: DonationCreateRequest) -> DonationCreateResponse:
        shelter = await PublicShelter.find_one(
            {
                "shelter_code": payload.shelter_code.upper(),
                "status": {"$in": ["open", "full"]},
            }
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

        donation_id = f"donation:{new_ulid()}"
        tracking_token = f"TX-{payload.shelter_code.upper()}-{secrets.token_hex(16).upper()}"
        booking_ref = f"DN-{secrets.randbelow(900000) + 100000}"
        now = datetime.now(UTC)
        expires_at = now + timedelta(hours=72)
        token_hash = sha256_hex(tracking_token)

        items_declared = [item.model_dump(exclude_none=True) for item in payload.items]
        declared = _declared_items(items_declared)

        buffer = DonationBuffer(
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
        await buffer.insert()

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
                )
            )

        # Fallback: buffer row before / if stub missing (create race or legacy rows).
        buffer = await DonationBuffer.find_one(DonationBuffer.tracking_token_hash == token_hash)
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
            )
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
