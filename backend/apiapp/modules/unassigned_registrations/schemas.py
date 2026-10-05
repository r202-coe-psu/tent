"""Unassigned Registration public API schemas (CR-113)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from tent_model.public_shelter import GeoPoint

# CR-148 — household animal cap (count per row and total per household).
PETS_MAX_COUNT = 10
RELIGION_OTHER_MAX_LEN = 60
DISABILITY_OTHER_DETAIL_MAX_LEN = 120
DORM_FIELD_MAX_LEN = 120


class PersonIdInput(BaseModel):
    cardType: Literal["national_id", "passport", "pink_card", "other", "anonymous"] = "national_id"
    number: str | None = None


class PersonIdOut(BaseModel):
    """Person id on create responses — distinct from request PersonIdInput."""

    cardType: Literal["national_id", "passport", "pink_card", "other", "anonymous"]
    number: str | None = None


class EmergencyContactInput(BaseModel):
    name: str = ""
    phone: str = ""
    relation: str = ""

    @field_validator("name", "phone", "relation", mode="before")
    @classmethod
    def _strip_str(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class EmergencyContactOut(BaseModel):
    name: str
    phone: str
    relation: str


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
    # CR-148 FR-13 — free text when religion == "other"; forced None otherwise.
    religion_other: str | None = Field(default=None, max_length=RELIGION_OTHER_MAX_LEN)
    # CR-148 FR-14 — optional detail when vulnerable_groups has "disability_other".
    disability_other_detail: str | None = Field(
        default=None, max_length=DISABILITY_OTHER_DETAIL_MAX_LEN
    )
    emergency_contact: EmergencyContactInput | None = None
    # GridFS ref `gfs:{oid}` from POST …/photos (#255).
    photo: str | None = None

    @field_validator("first_name", "last_name", "country", mode="before")
    @classmethod
    def _strip_str(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator(
        "phone",
        "nickname",
        "religion",
        "religion_other",
        "disability_other_detail",
        "photo",
        mode="before",
    )
    @classmethod
    def _blank_optional_str_to_none(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return value

    @model_validator(mode="after")
    def _omit_blank_emergency_contact(self) -> MemberInput:
        contact = self.emergency_contact
        if contact is None:
            return self
        if not contact.name and not contact.phone and not contact.relation:
            self.emergency_contact = None
        return self

    @model_validator(mode="after")
    def _drop_orphan_other_details(self) -> MemberInput:
        """CR-148 — `*_other` details only persist alongside their parent choice."""
        if self.religion != "other":
            self.religion_other = None
        if "disability_other" not in self.vulnerable_groups:
            self.disability_other_detail = None
        return self


class PetInput(BaseModel):
    species: Literal["dog", "cat", "other"]
    # New rows: one animal per row (count=1). Legacy count>1 claimed as one unit.
    count: int = Field(default=1, ge=1, le=PETS_MAX_COUNT)
    notes: str | None = None
    has_cage: bool = False
    # GridFS ref `gfs:{oid}` from POST …/photos (#255 pet photo).
    image_url: str | None = None

    @field_validator("notes", "image_url", mode="before")
    @classmethod
    def _blank_optional_str_to_none(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return value


class OpenPetHit(BaseModel):
    """Open pet surfaced by staff search/detail — claimable."""

    pet_id: str
    status: Literal["open"] = "open"
    species: Literal["dog", "cat", "other"]
    count: int = 1
    notes: str | None = None
    has_cage: bool = False
    image_url: str | None = None


class PetCreated(BaseModel):
    pet_id: str
    status: Literal["open", "claimed", "cancelled"]
    species: Literal["dog", "cat", "other"]
    count: int = 1
    notes: str | None = None
    has_cage: bool = False
    image_url: str | None = None
    claimed_shelter_code: str | None = None
    claimed_at: str | None = None
    claimed_by: str | None = None


class ClaimedPetOut(BaseModel):
    pet_id: str
    status: Literal["claimed"] = "claimed"
    species: Literal["dog", "cat", "other"]
    count: int = 1


class HouseholdInput(BaseModel):
    housing_type: (
        Literal["owned_house", "rented_house", "condo", "apartment_dorm", "homeless"] | None
    ) = None
    residence_landmark: str | None = None
    # CR-148 FR-15 — structured dorm address; only kept for housing_type apartment_dorm.
    dorm_name: str | None = Field(default=None, max_length=DORM_FIELD_MAX_LEN)
    dorm_building: str | None = Field(default=None, max_length=DORM_FIELD_MAX_LEN)
    dorm_floor: str | None = Field(default=None, max_length=DORM_FIELD_MAX_LEN)
    dorm_room: str | None = Field(default=None, max_length=DORM_FIELD_MAX_LEN)
    address_no: str | None = None
    village_no: str | None = None
    subdistrict: str | None = None
    district: str | None = None
    province: str | None = None
    postal_code: str | None = None
    geo: GeoPoint | None = None
    pets: list[PetInput] = Field(default_factory=list)
    label: str | None = None

    @field_validator("dorm_name", "dorm_building", "dorm_floor", "dorm_room", mode="before")
    @classmethod
    def _blank_dorm_to_none(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return value

    @model_validator(mode="after")
    def _validate_cr148_dorm(self) -> HouseholdInput:
        """CR-148 FR-15/FR-17 — dorm name + room required for apartment_dorm; else cleared."""
        if self.housing_type == "apartment_dorm":
            if not self.dorm_name or not self.dorm_room:
                raise ValueError("apartment_dorm residence requires dorm_name and dorm_room")
            return self
        self.dorm_name = None
        self.dorm_building = None
        self.dorm_floor = None
        self.dorm_room = None
        return self

    @model_validator(mode="after")
    def _validate_cr148_pet_total(self) -> HouseholdInput:
        """CR-148 FR-08 — total animals per household ≤ PETS_MAX_COUNT."""
        total = sum(pet.count for pet in self.pets)
        if total > PETS_MAX_COUNT:
            raise ValueError(f"household pets total {total} exceeds max {PETS_MAX_COUNT}")
        return self

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
    join_registration_id: str | None = Field(
        default=None,
        description=(
            "Append members (and pets) into this registration's reserved household "
            "(allowed even when document status is closed — reopen on append)."
        ),
    )


class UnassignedResidenceMatchRequest(BaseModel):
    """Service-to-service residence match — no member PII in response."""

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
    phone: str | None = None


class UnassignedResidenceMatchHit(BaseModel):
    id: str
    landmark: str | None = None
    housing_type: str | None = None
    claimed_shelter_code: str | None = None
    claimed_household_id: str | None = None
    status: str = "open"
    primary_contact_name_masked: str | None = None
    matched_member_masked: str | None = None
    member_count: int = 0
    pets: list[dict[str, Any]] = Field(default_factory=list)
    household_address: dict[str, Any] | None = None


class UnassignedResidenceMatchResponse(BaseModel):
    matches: list[UnassignedResidenceMatchHit]


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
    birth_year: int | None = None
    age: int | None = None
    nickname: str | None = None
    religion: str | None = None
    religion_other: str | None = None
    disability_other_detail: str | None = None
    emergency_contact: EmergencyContactOut | None = None
    photo: str | None = None


class UnassignedPhotoUploadResponse(BaseModel):
    """Response from POST /public/v1/unassigned-registrations/photos."""

    success: bool = True
    photo_id: str
    content_type: str
    filename: str
    width: int | None = None
    height: int | None = None
    original_size: int | None = None
    compressed_size: int | None = None
    thumbnail_size: int | None = None


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
    nickname: str | None = None
    religion: str | None = None
    religion_other: str | None = None
    disability_other_detail: str | None = None
    emergency_contact: EmergencyContactOut | None = None
    photo: str | None = None
    birth_year: int | None = None
    age: int | None = None


class UnassignedRegistrationSearchHit(BaseModel):
    id: str
    reserved_household_id: str
    registered_via: Literal["web", "staff"]
    status: str
    created_at: str
    open_members: list[OpenMemberHit]
    open_pets: list[OpenPetHit] = Field(default_factory=list)


class UnassignedRegistrationSearchResponse(BaseModel):
    results: list[UnassignedRegistrationSearchHit]


class HouseholdOut(BaseModel):
    housing_type: str | None = None
    residence_landmark: str | None = None
    dorm_name: str | None = None
    dorm_building: str | None = None
    dorm_floor: str | None = None
    dorm_room: str | None = None
    address_no: str | None = None
    village_no: str | None = None
    subdistrict: str | None = None
    district: str | None = None
    province: str | None = None
    postal_code: str | None = None
    geo: GeoPoint | None = None
    label: str | None = None
    pets: list[PetCreated] = Field(default_factory=list)


class UnassignedRegistrationListItem(BaseModel):
    id: str
    reserved_household_id: str
    registered_via: Literal["web", "staff"]
    status: str
    created_at: str
    household: HouseholdOut
    open_members: list[OpenMemberHit]
    open_member_count: int
    open_pets: list[OpenPetHit] = Field(default_factory=list)
    open_pet_count: int = 0


class UnassignedRegistrationListResponse(BaseModel):
    items: list[UnassignedRegistrationListItem]
    total: int
    open_member_count: int
    limit: int
    offset: int


class UnassignedRegistrationDetailResponse(BaseModel):
    id: str
    schema_v: int
    reserved_household_id: str
    registered_via: Literal["web", "staff"]
    status: str
    created_at: str
    household: HouseholdOut
    members: list[MemberCreated]


class UnassignedRegistrationStatsResponse(BaseModel):
    open_registrations: int
    open_members: int


class UnassignedRegistrationClaimRequest(BaseModel):
    """Staff claim — open members and/or pets (draft-persistent-unassigned-family)."""

    member_ids: list[str] = Field(default_factory=list, max_length=20)
    pet_ids: list[str] = Field(default_factory=list, max_length=50)
    shelter_code: str | None = None

    @field_validator("member_ids", "pet_ids")
    @classmethod
    def _dedupe_ids(cls, value: list[str]) -> list[str]:
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

    @model_validator(mode="after")
    def _require_at_least_one_target(self) -> UnassignedRegistrationClaimRequest:
        if not self.member_ids and not self.pet_ids:
            raise ValueError("claim requires at least one member_id or pet_id")
        return self


class ClaimedMemberOut(BaseModel):
    reserved_evacuee_id: str
    status: Literal["claimed"] = "claimed"
    first_name: str
    last_name: str


class UnassignedRegistrationClaimResponse(BaseModel):
    success: bool = True
    id: str | None
    deleted: bool = False
    shelter_code: str
    household_id: str
    evacuee_ids: list[str]
    claimed: list[ClaimedMemberOut]
    claimed_pets: list[ClaimedPetOut] = Field(default_factory=list)
    remaining_open: list[OpenMemberHit]
    remaining_open_pets: list[OpenPetHit] = Field(default_factory=list)


class UnassignedRegistrationReviewResponse(BaseModel):
    """Staff pre-claim review (CR-140 addendum) — open rows only, no write.

    Household carries address fields only (no `pets` — those live in `open_pets`,
    unlike `HouseholdOut` which embeds every pet with claim status for the SA detail view).
    """

    id: str
    reserved_household_id: str
    registered_via: Literal["web", "staff"]
    status: str
    created_at: str
    housing_type: str | None = None
    residence_landmark: str | None = None
    dorm_name: str | None = None
    dorm_building: str | None = None
    dorm_floor: str | None = None
    dorm_room: str | None = None
    address_no: str | None = None
    village_no: str | None = None
    subdistrict: str | None = None
    district: str | None = None
    province: str | None = None
    postal_code: str | None = None
    label: str | None = None
    open_members: list[OpenMemberHit]
    open_pets: list[OpenPetHit] = Field(default_factory=list)
