"""Public audit log — Mongo ``audit_events`` (CR-231, single collection, schema_v 1).

One envelope for every public log; ``payload`` is validated per ``event_type`` from
``EVENT_REGISTRY`` (the only list of event types). Mongo only: nothing here is synced to CouchDB,
so ``actor.client_ip`` and ``payload.searcher`` / ``purpose_note`` (PII) stay on the public plane.
The collection is append-only by convention (application code never updates or deletes), and has
no TTL — rows are kept permanently (#1213).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo import IndexModel

AUDIT_ID_PREFIX = "audit_event:"

SearchPurpose = Literal["find_family", "find_acquaintance", "coordinate_aid", "other"]

#: Consent text version recorded with every public search (FR-16a).
SEARCH_CONSENT_VERSION = "search-v1"


class _Strict(BaseModel):
	model_config = ConfigDict(extra="forbid")


class PublicSearcherActor(_Strict):
	"""Who triggered the event. ``client_ip`` is PII (real ``X-Real-IP``); ``ip_hash`` is not."""

	kind: Literal["public_searcher"] = "public_searcher"
	ip_hash: str
	client_ip: str | None = None


class AuditSubject(_Strict):
	"""The entity an event is about, when there is one (``public.search`` has none)."""

	kind: str
	id: str


class Searcher(_Strict):
	"""Who ran a public search. PII."""

	first_name: str
	last_name: str = ""
	phone: str


class PublicSearchPayload(_Strict):
	query_kind: str
	query_hash: str
	result_count: int = Field(ge=0)
	searcher: Searcher
	purpose: SearchPurpose
	#: Free text, may hold PII; present only when ``purpose == "other"``.
	purpose_note: str | None = None
	consent_version: str


#: Registry of event types → payload model. Adding an event type = one entry here.
EVENT_REGISTRY: dict[str, type[BaseModel]] = {
	"public.search": PublicSearchPayload,
}


def validate_payload(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
	"""Check ``payload`` against the registry; returns it normalised (``None`` fields dropped)."""
	model = EVENT_REGISTRY.get(event_type)
	if model is None:
		raise ValueError(f"unknown audit event_type: {event_type!r}")
	return model.model_validate(payload).model_dump(mode="json", exclude_none=True)


class AuditEvent(Document):
	"""``audit_events`` row."""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	schema_v: int = 1
	event_type: str
	occurred_at: datetime
	actor: PublicSearcherActor
	#: Ties the event to FastAPI / nginx logs (``X-Request-ID``) when the caller sent one.
	request_id: str | None = None
	subject: AuditSubject | None = None
	payload: dict[str, Any]

	@model_validator(mode="after")
	def _validate_payload(self) -> AuditEvent:
		self.payload = validate_payload(self.event_type, self.payload)
		return self

	class Settings:
		name = "audit_events"
		indexes = [IndexModel([("event_type", 1), ("occurred_at", -1)])]
