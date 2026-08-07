"""Managed external API keys (Mongo) — CR-062."""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class ApiKey(Document):
	"""External consumer API key — plaintext shown once on create; store hash only."""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	name: str
	owner: str
	key_prefix: str
	key_hash: str
	expires_at: datetime
	created_by: str
	created_at: datetime
	revoked_at: datetime | None = None
	last_used_at: datetime | None = None

	class Settings:
		name = "api_keys"
		indexes = [
			IndexModel([("key_prefix", 1)], unique=True),
		]
