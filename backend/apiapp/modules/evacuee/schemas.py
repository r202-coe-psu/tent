"""Evacuee public search API schemas."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal, Self

from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator
from tent_model.audit_event import SearchPurpose

from ...utils.masking import normalize_phone


class SearchRequest(BaseModel):
    search: str = Field(
        ...,
        min_length=1,
        max_length=200,
        validation_alias=AliasChoices("search", "q", "query"),
    )


#: Same rule as `isThaiMobilePhone` (frontend `$lib/db/model`). ASCII digits only: `\d` would also
#: accept Thai/Arabic-Indic digits, which the frontend (`/^0\d{9}$/`, JS = ASCII) rejects.
_THAI_MOBILE = re.compile(r"0[0-9]{9}")


class Searcher(BaseModel):
    """Who is searching (CR-231 FR-3/FR-8)."""

    first_name: str = Field(..., max_length=100)
    last_name: str = Field("", max_length=100)
    phone: str

    @field_validator("first_name", mode="before")
    @classmethod
    def _strip_first_name(cls, value: object) -> object:
        # Trim before `max_length` so the limit applies to the trimmed value (matches the Zod rule).
        return value.strip() if isinstance(value, str) else value

    @field_validator("first_name")
    @classmethod
    def _first_name(cls, value: str) -> str:
        if not value:
            raise ValueError("first_name is required")
        return value

    @field_validator("last_name", mode="before")
    @classmethod
    def _last_name(cls, value: object) -> object:
        if value is None:
            return ""
        return value.strip() if isinstance(value, str) else value

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        if not _THAI_MOBILE.fullmatch(value):
            raise ValueError("phone must be a Thai mobile number (0 + 9 digits)")
        return normalize_phone(value)


class PublicSearchRequest(SearchRequest):
    """`POST /public/v1/occupants` body: the search plus consent + purpose (CR-231).

    `/external/v1/occupants` keeps plain `SearchRequest` (ND-1: no consent fields).
    """

    searcher: Searcher
    purpose: SearchPurpose
    purpose_note: str | None = Field(None, max_length=200)
    consent_accepted: Literal[True]

    @field_validator("purpose_note", mode="before")
    @classmethod
    def _strip_purpose_note(cls, value: object) -> object:
        # Trim first so `max_length=200` (1-200 rule) is checked on the trimmed text.
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _purpose_note_rules(self) -> Self:
        note = self.purpose_note.strip() if self.purpose_note is not None else ""
        if self.purpose == "other":
            if not note:
                raise ValueError("purpose_note is required (1-200 chars) when purpose is other")
            self.purpose_note = note
        else:
            if note:
                raise ValueError("purpose_note is only allowed when purpose is other")
            self.purpose_note = None
        return self


ShelterStatus = Literal["open", "closed", "full", "standby"]


class FamilyMember(BaseModel):
    name: str
    status: str
    shelter_name: str
    shelter_status: ShelterStatus | None = None


class SearchResult(BaseModel):
    name: str
    status: str
    national_id: str | None = None
    gender: str | None = None
    shelter_name: str
    shelter_address: str | None = None
    origin_address: str | None = None
    checked_in_at: datetime | None = None
    shelter_status: ShelterStatus | None = None
    family_members: list[FamilyMember] = Field(default_factory=list)


class SearchResponse(BaseModel):
    results: list[SearchResult]
    count: int
    as_of: datetime


class ExternalSearchResult(SearchResult):
    """`/external/v1/occupants` keeps the zone partners read (CR-183 FR-18 is public-only)."""

    care_zone: str | None = None
    zone_name: str | None = None


class ExternalSearchResponse(BaseModel):
    results: list[ExternalSearchResult]
    count: int
    as_of: datetime


class ApiErrorBody(BaseModel):
    code: str
    message: str


class ApiErrorResponse(BaseModel):
    error: ApiErrorBody
