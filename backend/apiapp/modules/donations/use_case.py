"""Donations public intake and tracking use case."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from tent_model.donation_buffer import DonationBuffer, DonorBuffer
from tent_model.public_donation import PublicDonation
from tent_model.public_shelter import PublicShelter

from ...utils.masking import sha256_hex
from .schemas import DonationCreateRequest, DonationCreateResponse, DonationTrackingResponse


class DonationsUseCase:
    async def create(self, payload: DonationCreateRequest) -> DonationCreateResponse:
        shelter = await PublicShelter.find_one(
            PublicShelter.shelter_code == payload.shelter_code.upper(),
            PublicShelter.status == "open",
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

        donation_id = f"donation:{uuid.uuid4().hex[:26].upper()}"
        tracking_token = f"TX-{payload.shelter_code.upper()}-{secrets.token_hex(4).upper()}"
        booking_ref = f"DN-{secrets.randbelow(900000) + 100000}"
        now = datetime.now(UTC)
        expires_at = now + timedelta(hours=72)

        items_declared = [item.model_dump(exclude_none=True) for item in payload.items]

        buffer = DonationBuffer(
            id=donation_id,
            shelter_code=payload.shelter_code.upper(),
            donor=DonorBuffer(**payload.donor.model_dump()),
            items_declared=items_declared,
            logistics=payload.logistics,
            booking_ref=booking_ref,
            tracking_token=tracking_token,
            tracking_token_hash=sha256_hex(tracking_token),
            status="declared",
            synced_to_couch=False,
            created_at=now,
            expires_at=expires_at,
        )
        await buffer.insert()

        return DonationCreateResponse(
            tracking_token=tracking_token,
            booking_ref=booking_ref,
        )

    async def get_by_tracking_token(self, tracking_token: str) -> DonationTrackingResponse:
        token_hash = sha256_hex(tracking_token)
        donation = await PublicDonation.find_one(PublicDonation.tracking_token_hash == token_hash)
        if donation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "Donation record not found"},
            )

        return DonationTrackingResponse(
            donation={
                "status": donation.status,
                "booking_ref": donation.booking_ref,
                "shelter_code": donation.shelter_code,
                "donor": {},
                "items": [item.model_dump() for item in donation.items_declared],
                "received_summary": donation.received_summary,
                "updated_at": donation.updated_at.isoformat(),
            }
        )


def get_donations_use_case() -> DonationsUseCase:
    return DonationsUseCase()
