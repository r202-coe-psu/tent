"""Third-party OAuth2 client credentials (Mongo) — ADR 0002 / EXT-001."""

from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel

THIRD_PARTY_SCOPES = (
	"location-read",
	"location-stock-read",
	"occupancy-read",
	"occupancy-pii-read",
)


class ThirdPartyClient(Document):
	"""Partner module credential — plaintext secret shown once on provision; store hash only."""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	client_id: str
	client_secret_hash: str
	module_name: str
	allowed_scopes: list[str] = Field(default_factory=list)
	is_active: bool = True
	created_at: datetime
	updated_at: datetime

	class Settings:
		name = "third_party_clients"
		indexes = [
			IndexModel([("client_id", 1)], unique=True),
		]
