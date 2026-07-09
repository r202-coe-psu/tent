from __future__ import annotations

from datetime import datetime
from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class Donor(BaseModel):
    name: str
    phone_hash: str
    line_id: str | None = None
    email: str | None = None


class DonationItem(BaseModel):
    category: str
    free_text: str
    qty: int
    unit: str
    condition: str
    note: str | None = None


class LogisticsSlot(BaseModel):
    # Snapshot from DonationSlot
    date: str
    from_time: str
    to_time: str


class Logistics(BaseModel):
    delivery_method: str
    vehicle: str | None = None
    slot: LogisticsSlot | None = None
    eta: datetime | None = None
    courier_tracking_no: str | None = None


class PublicDonation(Document):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    type: str = "donation"
    schema_v: int = 2
    shelter_code: str
    channel: str = "public"
    booking_ref: str
    tracking_token_hash: str
    donor: Donor
    kind: str = "items"
    items: list[DonationItem] = Field(default_factory=list)
    logistics: Logistics
    status: str = "declared"
    declared_at: datetime
    expires_at: datetime | None = None
    updated_at: datetime | None = None

    class Settings:
        name = "public_donations"
        indexes = [
            IndexModel([("tracking_token_hash", 1)]),
            IndexModel([("booking_ref", 1)]),
            IndexModel([("shelter_code", 1)]),
            IndexModel([("donor.phone_hash", 1)]),
        ]
