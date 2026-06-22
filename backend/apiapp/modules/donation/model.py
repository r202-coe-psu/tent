from beanie import Document
from pydantic import Field
from typing import List, Optional
from datetime import datetime
from pymongo import IndexModel, ASCENDING
from .schemas import DonorInfo, DeclaredItem, LogisticsInfo

class Donation(Document):
    tracking_token: str
    tracking_token_hash: str
    booking_ref: Optional[str] = None
    shelter_code: str
    donor: DonorInfo
    items_declared: List[DeclaredItem]
    logistics: Optional[LogisticsInfo] = None
    campaign_id: Optional[str] = None
    status: str = "declared"
    channel: str = "public"
    created_at: datetime
    expires_at: datetime
    received_summary: Optional[str] = None
    synced_to_couch: bool = False

    class Settings:
        name = "donations"
        indexes = [
            IndexModel([("tracking_token_hash", ASCENDING)], unique=True)
        ]

class DonationSlot(Document):
    date: str
    from_: str = Field(alias="from")
    to: str
    capacity: int
    shelter_code: str

    class Settings:
        name = "donation_slots"
        indexes = [
            IndexModel([("date", ASCENDING), ("from_", ASCENDING), ("shelter_code", ASCENDING)], unique=True)
        ]
