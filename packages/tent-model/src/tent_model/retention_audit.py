from __future__ import annotations

from datetime import datetime
from typing import Any

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class RetentionAudit(Document):
	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	job_run_id: str
	trigger: str
	target_collection: str
	target_id: str
	couchdb_ref: dict[str, Any] | None = None
	action: str
	status: str
	deleted_count: int = 0
	verified_at: datetime | None = None
	error: str | None = None
	created_at: datetime

	class Settings:
		name = "_retention_audit"
		indexes = [
			IndexModel([("job_run_id", 1)]),
			IndexModel([("status", 1), ("created_at", 1)]),
			IndexModel([("target_collection", 1), ("target_id", 1)]),
		]
