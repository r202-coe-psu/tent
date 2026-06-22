import uuid
import hashlib
from datetime import datetime, timedelta
from typing import Optional
from .schemas import DonationPreDeclarationInput, DonationResponse, DonationDetailResponse
from .model import Donation
from ...core.exceptions import NotFoundError, ValidationError

class DonationUseCase:
    def _get_sha256_hash(self, value: str) -> str:
        return hashlib.sha256(value.encode('utf-8')).hexdigest()

    async def create_donation(self, payload: DonationPreDeclarationInput) -> dict:
        if not payload.shelter_code or not payload.donor.name or not payload.donor.phone:
            raise ValidationError("Missing required donor or shelter information")
        if not payload.items_declared:
            raise ValidationError("Items array cannot be empty")

        tracking_token = f"TX-DON-{str(uuid.uuid4())[:8].upper()}"
        tracking_token_hash = self._get_sha256_hash(tracking_token)
        booking_ref = f"DN-{str(uuid.uuid4())[:6].upper()}"

        now = datetime.utcnow()
        expires_at = now + timedelta(hours=72)

        doc = Donation(
            tracking_token=tracking_token,
            tracking_token_hash=tracking_token_hash,
            booking_ref=booking_ref,
            shelter_code=payload.shelter_code,
            donor=payload.donor,
            items_declared=payload.items_declared,
            logistics=payload.logistics,
            status="declared",
            channel="public",
            created_at=now,
            expires_at=expires_at,
            synced_to_couch=False
        )

        await doc.insert()

        return {
            "success": True,
            "trackingToken": tracking_token,
            "booking_ref": booking_ref,
            "as_of": now
        }

    async def get_donation_by_token(self, tracking_token: str) -> dict:
        token_hash = self._get_sha256_hash(tracking_token)
        doc = await Donation.find_one(Donation.tracking_token_hash == token_hash)
        if not doc:
            raise NotFoundError("Donation record not found")

        return {
            "success": True,
            "donation": {
                "status": doc.status,
                "shelter_code": doc.shelter_code,
                "booking_ref": doc.booking_ref,
                "items_declared": [item.model_dump() for item in doc.items_declared],
                "logistics": doc.logistics.model_dump() if doc.logistics else None,
                "received_summary": doc.received_summary,
                "created_at": doc.created_at.isoformat() + "Z",
                "expires_at": doc.expires_at.isoformat() + "Z"
            }
        }

def get_donation_use_case() -> DonationUseCase:
    return DonationUseCase()
