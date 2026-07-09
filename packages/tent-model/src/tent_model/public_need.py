from __future__ import annotations

from datetime import datetime
from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class DonationSlot(BaseModel):
    date: str
    from_time: str
    to_time: str
    capacity: int = 0
    booked: int = 0
    is_full: bool = False


class NeedItem(BaseModel):
    category: str
    item_type: str
    qty_target: int = 0
    qty_received: int = 0
    needs_open: int = 0
    is_urgent: bool = False
    is_closed: bool = False


class PublicNeed(Document):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    shelter_code: str # Link with PublicShelter
    campaign_name: str | None = None
    needs: list[NeedItem] = Field(default_factory=list)
    slots: list[DonationSlot] = Field(default_factory=list)
    updated_at: datetime

    class Settings:
        name = "public_needs"
        indexes = [
            IndexModel([("shelter_code", 1)]),
        ]
