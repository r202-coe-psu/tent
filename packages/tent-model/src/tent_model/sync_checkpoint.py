from __future__ import annotations

from datetime import UTC, datetime

from beanie import Document
from pydantic import ConfigDict, Field


class SyncCheckpoint(Document):
	"""CouchDB _changes resume point per database."""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	database: str
	last_seq: str | int
	updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

	class Settings:
		name = "_sync_checkpoints"
