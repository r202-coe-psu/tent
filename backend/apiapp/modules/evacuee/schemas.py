"""Evacuee public search API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, Field


class SearchRequest(BaseModel):
    search: str = Field(
        ...,
        min_length=1,
        max_length=200,
        validation_alias=AliasChoices("search", "q", "query"),
    )


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
