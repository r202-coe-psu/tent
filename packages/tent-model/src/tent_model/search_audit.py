from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class SearchAudit(Document):
	"""Public family-search audit buffer → inbound sync to ``central_ops``.

	Stores hashes only (never raw query / IP). ``synced_to_couch`` gates inbound.
	"""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	query_kind: str
	query_hash: str
	ip_hash: str
	result_count: int
	occurred_at: datetime
	synced_to_couch: bool = False

	class Settings:
		name = "search_audits"
		indexes = [
			IndexModel([("synced_to_couch", 1)]),
			IndexModel([("occurred_at", 1)]),
		]
