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
	# Reversible (Fernet) encryption of the same plaintext, for the admin "view again"
	# feature only — never read on the `/external/token` verify path. `None` on docs
	# created before this field existed (schema.md §9.6, draft-partner-client-secret-
	# reveal-edit-delete) — those secrets cannot be recovered.
	client_secret_encrypted: str | None = None
	# Admin-chosen display name, unique case-insensitively. `None` only on docs created
	# before the field existed (schema.md §9.6).
	name: str | None = None
	description: str | None = None
	module_name: str
	allowed_scopes: list[str] = Field(default_factory=list)
	is_active: bool = True
	# Soft-delete timestamp — set only once `is_active` is False (revoke first). `find_all`
	# use-case queries filter this out; the doc itself is never hard-deleted (audit trail).
	deleted_at: datetime | None = None
	created_at: datetime
	updated_at: datetime

	class Settings:
		name = "third_party_clients"
		indexes = [
			IndexModel([("client_id", 1)], unique=True),
			IndexModel(
				[("name", 1)],
				name="name_unique_ci",
				unique=True,
				collation={"locale": "en", "strength": 2},
				partialFilterExpression={"name": {"$type": "string"}},
			),
		]
