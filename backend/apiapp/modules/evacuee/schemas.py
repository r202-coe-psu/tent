"""Evacuee public search API schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import AliasChoices, BaseModel, Field


class SearchRequest(BaseModel):
    search: str = Field(
        ...,
        min_length=1,
        max_length=200,
        validation_alias=AliasChoices("search", "q", "query"),
    )


class SearchResult(BaseModel):
    name: str
    status: str
    national_id: str | None = None
    gender: str | None = None
    shelter_name: str
    origin_address: str | None = None
    checked_in_at: datetime | None = None
    care_zone: str | None = None


class SearchResponse(BaseModel):
    results: list[SearchResult]
    count: int
    as_of: datetime


class ApiErrorBody(BaseModel):
    code: str
    message: str


class ApiErrorResponse(BaseModel):
    error: ApiErrorBody
