from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class DonorBuffer(BaseModel):
	name: str
	phone: str
	line_id: str | None = None
	email: str | None = None


class DonationBuffer(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	shelter_code: str
	donor: DonorBuffer
	items_declared: list[dict[str, Any]] = Field(default_factory=list)
	logistics: dict[str, Any] | None = None
	campaign_id: str | None = None
	booking_ref: str
	tracking_token: str
	tracking_token_hash: str
	status: str = "declared"
	synced_to_couch: bool = False
	created_at: datetime
	expires_at: datetime | None = None

	class Settings:
		name = "donations"
		indexes = [
			IndexModel([("synced_to_couch", 1)]),
			IndexModel([("tracking_token_hash", 1)], unique=True),
		]
