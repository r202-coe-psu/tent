"""Evacuee PDPA consent (spec docs/features/pdpa-consent-block-spec.md §4).

Mirrors the Zod `evacueeConsentSchema` in `frontend/src/lib/features/consent/domain/consent.ts`;
both are checked against `packages/tent-model/contracts/evacuee-consent.cases.json`.
Python never decides consent policy: the BFF plans each member, this module only validates the
result and binds a web grant to its giver.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, get_args

from pydantic import (
	BaseModel,
	ConfigDict,
	Field,
	StrictBool,
	TypeAdapter,
	field_validator,
	model_validator,
)

EVACUEE_SCHEMA_V = 15

ConsentMode = Literal["full", "basic"]
ConsentGiver = Literal["self", "guardian", "household_member", "backfill"]
ConsentChannel = Literal["staff", "kiosk", "web", "backfill"]
WebConsentGiver = Literal["self", "guardian", "household_member"]

CONSENT_MODES: tuple[str, ...] = get_args(ConsentMode)
CONSENT_GIVERS: tuple[str, ...] = get_args(ConsentGiver)
CONSENT_CHANNELS: tuple[str, ...] = get_args(ConsentChannel)

CONSENT_REF_PATTERN = r"^CS-[0-9A-HJKMNP-TV-Z]{8}$"
EVACUEE_ID_PATTERN = r"^evacuee:"


class _ConsentStamp(BaseModel):
	model_config = ConfigDict(strict=True)

	ref: Annotated[str, Field(pattern=CONSENT_REF_PATTERN)]
	# Kept as the client's string so the Couch doc gets exactly what the person saw.
	given_at: str
	notice_version: Annotated[str, Field(min_length=1)]

	@field_validator("given_at")
	@classmethod
	def _iso_timestamp_with_offset(cls, value: str) -> str:
		try:
			parsed = datetime.fromisoformat(value)
		except ValueError as exc:
			raise ValueError("given_at must be an ISO timestamp") from exc
		if "T" not in value or parsed.tzinfo is None:
			raise ValueError("given_at must be an ISO timestamp with an offset")
		return value


class _FullMode(BaseModel):
	mode: Literal["full"]
	health: StrictBool


class _BasicMode(BaseModel):
	mode: Literal["basic"]
	health: Literal[False]


class _BoundConsent(_ConsentStamp):
	given_by: ConsentGiver
	giver_evacuee_id: Annotated[str, Field(pattern=EVACUEE_ID_PATTERN)] | None
	recorded_verbally_by: Annotated[str, Field(min_length=1)] | None
	channel: ConsentChannel

	@model_validator(mode="after")
	def _couplings(self) -> _BoundConsent:
		giver_is_another_member = self.given_by in ("guardian", "household_member")
		if giver_is_another_member != (self.giver_evacuee_id is not None):
			raise ValueError(f"giver_evacuee_id does not match given_by {self.given_by}")
		if (self.channel == "backfill") != (self.given_by == "backfill"):
			raise ValueError("channel backfill and given_by backfill must go together")
		if self.recorded_verbally_by is not None and self.channel != "staff":
			raise ValueError("verbal recording is only possible on the staff channel")
		return self


class FullEvacueeConsent(_BoundConsent, _FullMode):
	pass


class BasicEvacueeConsent(_BoundConsent, _BasicMode):
	pass


EvacueeConsent = Annotated[FullEvacueeConsent | BasicEvacueeConsent, Field(discriminator="mode")]
evacuee_consent_adapter: TypeAdapter[FullEvacueeConsent | BasicEvacueeConsent] = TypeAdapter(
	EvacueeConsent
)


class _WebGrant(_ConsentStamp):
	given_by: WebConsentGiver


class FullWebConsentGrant(_WebGrant, _FullMode):
	pass


class BasicWebConsentGrant(_WebGrant, _BasicMode):
	pass


# One member's consent as the public BFF planned it, before the registrant's evacuee id exists.
WebConsentGrant = Annotated[
	FullWebConsentGrant | BasicWebConsentGrant, Field(discriminator="mode")
]


def bind_web_consent(
	grant: FullWebConsentGrant | BasicWebConsentGrant, registrant_evacuee_id: str
) -> FullEvacueeConsent | BasicEvacueeConsent:
	return evacuee_consent_adapter.validate_python(
		{
			**grant.model_dump(),
			"channel": "web",
			"recorded_verbally_by": None,
			"giver_evacuee_id": None if grant.given_by == "self" else registrant_evacuee_id,
		}
	)
