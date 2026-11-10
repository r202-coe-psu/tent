"""Single-collection audit event (CR-231) — Mongo ``audit_events``.

One envelope for every audit: ``event_type`` is a namespaced string whose ``context`` / ``pii``
shape is validated per type from ``EVENT_REGISTRY`` (the one place that lists event types).
``context`` never holds PII; ``pii`` is Mongo-only and the worker drops the whole key before the
event reaches CouchDB (``central_ops``), so adding an event type needs no inbound change.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo import IndexModel

AUDIT_ID_PREFIX = "audit:"

AuditDomain = Literal["public", "shelter", "central"]
AuditOutcome = Literal["ok", "denied", "error"]
ActorKind = Literal["anonymous", "staff", "partner", "system"]
SearchPurpose = Literal["find_family", "find_acquaintance", "coordinate_aid", "other"]

#: Consent text version recorded with every public search (FR-16).
SEARCH_CONSENT_VERSION = "search-v1"


class _Strict(BaseModel):
	model_config = ConfigDict(extra="forbid")


class AuditActor(_Strict):
	kind: ActorKind
	id: str | None = None


class AuditTarget(_Strict):
	type: str
	id: str


class SearcherPii(_Strict):
	"""Who ran a public search. PII — Mongo only."""

	first_name: str
	last_name: str = ""
	phone: str


# ---- per-event_type context / pii -------------------------------------------------------------


class SearchContext(_Strict):
	query_kind: str
	query_hash: str
	ip_hash: str
	result_count: int = Field(ge=0)


class PublicSearchContext(SearchContext):
	purpose: SearchPurpose
	consent_version: str


class LegacyPublicSearchContext(SearchContext):
	"""Rows migrated from ``search_audits`` (FR-17a): v1 rows never recorded purpose / consent."""

	purpose: SearchPurpose | None = None
	consent_version: str | None = None


class LegacyPublicSearchPii(_Strict):
	"""Migrated rows: any subset of the PII a v1/v2 ``search_audits`` row carried."""

	searcher: SearcherPii | None = None
	client_ip: str | None = None
	purpose_note: str | None = None


class PublicSearchPii(_Strict):
	searcher: SearcherPii
	client_ip: str
	purpose_note: str | None = None


class EventSpec(BaseModel):
	domain: AuditDomain
	context: type[BaseModel]
	#: ``None`` = this event type must not carry ``pii``.
	pii: type[BaseModel] | None = None


#: The only list of event types written to Mongo. Typos / unknown types fail validation.
EVENT_REGISTRY: dict[str, EventSpec] = {
	"public.search": EventSpec(domain="public", context=PublicSearchContext, pii=PublicSearchPii),
	"external.search": EventSpec(domain="public", context=SearchContext),
}


def validate_event(
	event_type: str,
	domain: str,
	context: dict[str, Any],
	pii: dict[str, Any] | None,
	*,
	legacy: bool = False,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
	"""Check ``context`` / ``pii`` against the registry; returns the normalised pair.

	``legacy`` (rows migrated from ``search_audits``) relaxes ``public.search`` only: purpose,
	consent and ``pii`` may be absent on v1 rows.
	"""
	if legacy and event_type == "public.search":
		clean = LegacyPublicSearchContext.model_validate(context).model_dump(
			mode="json", exclude_none=True
		)
		return clean, (
			LegacyPublicSearchPii.model_validate(pii).model_dump(mode="json")
			if pii is not None
			else None
		)
	spec = EVENT_REGISTRY.get(event_type)
	if spec is None:
		raise ValueError(f"unknown audit event_type: {event_type!r}")
	if spec.domain != domain:
		raise ValueError(f"{event_type} must have domain {spec.domain!r}")
	clean_context = spec.context.model_validate(context).model_dump(mode="json")
	if spec.pii is None:
		if pii is not None:
			raise ValueError(f"{event_type} must not carry pii")
		return clean_context, None
	if pii is None:
		raise ValueError(f"{event_type} requires pii")
	return clean_context, spec.pii.model_validate(pii).model_dump(mode="json")


class AuditEvent(Document):
	"""``audit_events`` row; ``synced_to_couch`` gates the inbound loop (append-only otherwise)."""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	schema_v: int = 1
	event_type: str
	domain: AuditDomain
	occurred_at: datetime
	actor: AuditActor
	target: AuditTarget | None = None
	outcome: AuditOutcome = "ok"
	context: dict[str, Any] = Field(default_factory=dict)
	pii: dict[str, Any] | None = None
	synced_to_couch: bool = False
	#: Set only by the one-off ``search_audits`` migration (FR-17a).
	migrated_from: str | None = None

	@model_validator(mode="after")
	def _validate_event_type(self) -> AuditEvent:
		self.context, self.pii = validate_event(
			self.event_type,
			self.domain,
			self.context,
			self.pii,
			legacy=self.migrated_from is not None,
		)
		return self

	class Settings:
		name = "audit_events"
		indexes = [
			IndexModel([("event_type", 1), ("occurred_at", 1)]),
			IndexModel([("domain", 1), ("occurred_at", 1)]),
			IndexModel([("target.type", 1), ("target.id", 1)]),
			IndexModel(
				[("synced_to_couch", 1)],
				name="synced_to_couch_pending",
				partialFilterExpression={"synced_to_couch": False},
			),
		]
