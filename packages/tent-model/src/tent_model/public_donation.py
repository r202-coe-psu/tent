from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class DeclaredItem(BaseModel):
	item_name: str = ""
	qty: Any = None
	unit: str | None = None
	category: str | None = None


class PublicDonation(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	tracking_token_hash: str | None = None
	shelter_code: str
	status: str = "declared"
	booking_ref: str | None = None
	items_declared: list[DeclaredItem] = Field(default_factory=list)
	received_summary: dict[str, Any] | None = None
	updated_at: datetime

	class Settings:
		name = "public_donations"
		indexes = [
			IndexModel([("tracking_token_hash", 1)]),
			IndexModel([("shelter_code", 1)]),
		]
