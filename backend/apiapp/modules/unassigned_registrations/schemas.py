"""Unassigned Registration public API schemas (CR-113)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from tent_model.public_shelter import GeoPoint


class PersonIdInput(BaseModel):
    cardType: Literal["national_id", "passport", "pink_card", "other", "anonymous"] = "national_id"
    number: str | None = None


class PersonIdOut(BaseModel):
    """Person id on create responses — distinct from request PersonIdInput."""

    cardType: Literal["national_id", "passport", "pink_card", "other", "anonymous"]
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
    geo: GeoPoint | None = None
    pets: list[PetInput] = Field(default_factory=list)
    label: str | None = None

    @model_validator(mode="after")
    def _validate_cr112_residence(self) -> HouseholdInput:
        """CR-112 / FR-RF-09 — enforce on FastAPI so Bearer callers cannot bypass BFF Zod."""
        housing = self.housing_type
        landmark = (self.residence_landmark or "").strip()
        address_no = (self.address_no or "").strip()
        geo_complete = bool(
            (self.province or "").strip()
            and (self.district or "").strip()
            and (self.subdistrict or "").strip()
        )

        if housing == "homeless":
            if not landmark and not geo_complete and not address_no:
                raise ValueError(
                    "homeless residence requires residence_landmark or complete "
                    "province/district/subdistrict (or address_no)"
                )
            return self

        # Non-homeless and housing_type omitted: same floor as BFF Zod —
        # domicile address required so Bearer callers cannot skip FR-RF-09.
        if not address_no or not geo_complete:
            raise ValueError(
                "non-homeless residence requires address_no and province/district/subdistrict"
            )
        return self


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
    person_id: PersonIdOut | None = None
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


class OpenMemberHit(BaseModel):
    """Open member surfaced by staff search — claimable (not claimed/cancelled)."""

    reserved_evacuee_id: str
    status: Literal["open"] = "open"
    first_name: str
    last_name: str
    gender: str
    phone: str | None = None
    person_id: PersonIdOut | None = None
    country: str
    vulnerable_groups: list[str] = Field(default_factory=list)
    special_needs: list[str] = Field(default_factory=list)


class UnassignedRegistrationSearchHit(BaseModel):
    id: str
    reserved_household_id: str
    registered_via: Literal["web", "staff"]
    status: str
    created_at: str
    open_members: list[OpenMemberHit]


class UnassignedRegistrationSearchResponse(BaseModel):
    results: list[UnassignedRegistrationSearchHit]


class UnassignedRegistrationClaimRequest(BaseModel):
    """Staff claim — body selects open member reserved ids (CR-113 / #247)."""

    member_ids: list[str] = Field(min_length=1, max_length=20)
    shelter_code: str | None = None

    @field_validator("member_ids")
    @classmethod
    def _dedupe_member_ids(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item and str(item).strip()]
        # Preserve order while dropping duplicates.
        return list(dict.fromkeys(cleaned))

    @field_validator("shelter_code", mode="before")
    @classmethod
    def _blank_shelter_to_none(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip().upper()
            return trimmed or None
        return value


class ClaimedMemberOut(BaseModel):
    reserved_evacuee_id: str
    status: Literal["claimed"] = "claimed"
    first_name: str
    last_name: str


class UnassignedRegistrationClaimResponse(BaseModel):
    success: bool = True
    id: str | None
    deleted: bool
    shelter_code: str
    household_id: str
    evacuee_ids: list[str]
    claimed: list[ClaimedMemberOut]
    remaining_open: list[OpenMemberHit]
