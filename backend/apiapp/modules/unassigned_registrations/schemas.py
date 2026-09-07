"""Unassigned Registration public API schemas (CR-113)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class PersonIdInput(BaseModel):
    cardType: Literal["national_id", "passport", "pink_card", "other", "anonymous"] = "national_id"
    number: str | None = None


class MemberInput(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = ""
    gender: Literal["male", "female", "other"]
    phone: str | None = None
    person_id: PersonIdInput | None = None
    country: str = "THAILAND"
    vulnerable_groups: list[str] = Field(default_factory=list)
    special_needs: list[str] = Field(default_factory=list)
    birth_year: int | None = None
    age: int | None = None
    nickname: str | None = None
    religion: str | None = None

    @field_validator("first_name", "last_name", "country", mode="before")
    @classmethod
    def _strip_str(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("phone", mode="before")
    @classmethod
    def _blank_phone_to_none(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return value


class PetInput(BaseModel):
    species: Literal["dog", "cat", "other"]
    count: int = Field(default=1, ge=1, le=50)
    notes: str | None = None
    has_cage: bool = False


class HouseholdInput(BaseModel):
    housing_type: (
        Literal["owned_house", "rented_house", "condo", "apartment_dorm", "homeless"] | None
    ) = None
    residence_landmark: str | None = None
    address_no: str | None = None
    village_no: str | None = None
    subdistrict: str | None = None
    district: str | None = None
    province: str | None = None
    postal_code: str | None = None
    geo: dict[str, Any] | None = None
    pets: list[PetInput] = Field(default_factory=list)
    label: str | None = None


class UnassignedRegistrationCreateRequest(BaseModel):
    members: list[MemberInput] = Field(min_length=1, max_length=20)
    household: HouseholdInput
    registered_via: Literal["web", "staff"] = "web"


class MemberCreated(BaseModel):
    reserved_evacuee_id: str
    status: Literal["open", "claimed", "cancelled"]
    first_name: str
    last_name: str
    gender: str
    phone: str | None = None
    person_id: PersonIdInput | None = None
    country: str
    vulnerable_groups: list[str] = Field(default_factory=list)
    special_needs: list[str] = Field(default_factory=list)


class UnassignedRegistrationCreateResponse(BaseModel):
    success: bool = True
    id: str
    schema_v: int
    reserved_household_id: str
    members: list[MemberCreated]
    registered_via: Literal["web", "staff"]
    status: str
    created_at: str
