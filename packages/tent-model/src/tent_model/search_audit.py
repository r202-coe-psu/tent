from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class SearchAuditSearcher(BaseModel):
	"""Who ran a public search (CR-231). PII — Mongo only, never synced to CouchDB."""

	first_name: str
	last_name: str = ""
	phone: str


class SearchAudit(Document):
	"""Public occupants-search audit buffer → inbound sync to ``central_ops``.

	The query stays hash-only. CR-231 (public plane) adds ``searcher`` / ``client_ip`` /
	``purpose_note`` (PII, Mongo only) and ``purpose`` / ``consent_version`` (also synced to
	CouchDB); all optional so v1 rows read back unchanged. ``synced_to_couch`` gates inbound.
	"""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	query_kind: str
	query_hash: str
	ip_hash: str
	result_count: int
	occurred_at: datetime
	synced_to_couch: bool = False
	searcher: SearchAuditSearcher | None = None
	client_ip: str | None = None
	purpose: str | None = None
	purpose_note: str | None = None
	consent_version: str | None = None

	class Settings:
		name = "search_audits"
		indexes = [
			IndexModel([("synced_to_couch", 1)]),
			IndexModel([("occurred_at", 1)]),
		]
