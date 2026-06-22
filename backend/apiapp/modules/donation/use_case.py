import uuid
import hashlib
from datetime import datetime, timedelta
from typing import Optional
from .schemas import DonationPreDeclarationInput, DonationResponse, DonationDetailResponse
from ...infrastructure.database import db_helper
from ...core.exceptions import NotFoundError, ValidationError

class DonationUseCase:
    collection_name = "donations"

    def _get_sha256_hash(self, value: str) -> str:
        return hashlib.sha256(value.encode('utf-8')).hexdigest()

    async def create_donation(self, payload: DonationPreDeclarationInput) -> dict:
        if not payload.shelter_code or not payload.donor.name or not payload.donor.phone:
            raise ValidationError("Missing required donor or shelter information")
        if not payload.items_declared:
            raise ValidationError("Items array cannot be empty")

        tracking_token = f"TX-DON-{str(uuid.uuid4())[:8].upper()}"
        tracking_token_hash = self._get_sha256_hash(tracking_token)

        now = datetime.utcnow()
        expires_at = now + timedelta(hours=72)

        doc = {
            "tracking_token": tracking_token,
            "tracking_token_hash": tracking_token_hash,
            "shelter_code": payload.shelter_code,
            "donor": payload.donor.model_dump(),
            "items_declared": [item.model_dump() for item in payload.items_declared],
            "status": "declared",
            "created_at": now.isoformat() + "Z",
            "expires_at": expires_at.isoformat() + "Z",
            "synced_to_couch": False
        }

        await db_helper.db[self.collection_name].insert_one(doc)

        return {
            "success": True,
            "trackingToken": tracking_token,
            "as_of": now
        }

    async def get_donation_by_token(self, tracking_token: str) -> dict:
        token_hash = self._get_sha256_hash(tracking_token)
        doc = await db_helper.db[self.collection_name].find_one({"tracking_token_hash": token_hash})
        if not doc:
            raise NotFoundError("Donation record not found")

        return {
            "success": True,
            "donation": {
                "status": doc["status"],
                "shelter_code": doc["shelter_code"],
                "items_declared": doc["items_declared"],
                "received_summary": doc.get("received_summary"),
                "created_at": doc["created_at"],
                "expires_at": doc["expires_at"]
            }
        }

def get_donation_use_case() -> DonationUseCase:
    return DonationUseCase()
