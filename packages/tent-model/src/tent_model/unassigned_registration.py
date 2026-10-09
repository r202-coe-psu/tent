"""Mongo SoR for Unassigned Registration (CR-113 + draft-persistent-unassigned-family)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo import ASCENDING, IndexModel

from tent_model.public_shelter import GeoPoint

MemberStatus = Literal["open", "claimed", "cancelled"]
PetStatus = Literal["open", "claimed", "cancelled"]
# Document-level: open while any member/pet is open; closed = history (no hard-delete).
# Legacy readers may still see "claimed" / "partial_claim" — treat as closed-equivalent.
DocumentStatus = Literal["open", "closed", "claimed", "partial_claim"]
CardType = Literal["national_id", "passport", "pink_card", "other", "anonymous"]
RegisteredVia = Literal["web", "staff"]
HousingType = Literal[
	"owned_house",
	"rented_house",
	"condo",
	"apartment_dorm",
	"homeless",
]
PetSpecies = Literal["dog", "cat", "other"]

# New writes stamp schema_v 3 (pet_id + pet claim lifecycle + closed doc status).
UNASSIGNED_SCHEMA_V = 3


class PersonId(BaseModel):
	cardType: CardType = "national_id"
	number: str | None = None


class EmergencyContact(BaseModel):
	"""Optional emergency contact — omit entirely when name/phone/relation are blank."""

	name: str
	phone: str
	relation: str


class UnassignedMember(BaseModel):
	"""One household member on the central queue — not an Evacuee until claim."""

	reserved_evacuee_id: str
	status: MemberStatus = "open"
	first_name: str
	last_name: str = ""
	# decision sync 2026-10-09: null = ไม่ระบุ; 'other' legacy (read/preserve only).
	gender: Literal["male", "female", "other"] | None
	phone: str | None = None
	person_id: PersonId | None = None
	country: str = "THAILAND"
	vulnerable_groups: list[str] = Field(default_factory=list)
	special_needs: list[str] = Field(default_factory=list)
	birth_year: int | None = None
	age: int | None = None
	nickname: str | None = None
	religion: str | None = None
	# CR-148 — free text when religion == "other".
	religion_other: str | None = None
	# CR-148 — optional detail when vulnerable_groups has "disability_other".
	disability_other_detail: str | None = None
	emergency_contact: EmergencyContact | None = None
	# GridFS ref while queued (`gfs:{oid}`); claim births Couch `image:{ulid}` (#255).
	photo: str | None = None
	# Claim metadata (CR-113 algorithm — optional until claimed).
	claimed_at: datetime | None = None
	claimed_shelter_code: str | None = None
	claimed_by: str | None = None


class UnassignedPet(BaseModel):
	"""One pet row on the central queue — claimable independently of members."""

	# Optional on read for schema_v ≤2 legacy rows; writers mint pet:{ulid}.
	pet_id: str | None = None
	status: PetStatus = "open"
	species: PetSpecies
	count: int = 1
	notes: str | None = None
	has_cage: bool = False
	# GridFS ref while queued (`gfs:{oid}`); claim births Couch `image:{ulid}` (#255 pet photo).
	image_url: str | None = None
	claimed_at: datetime | None = None
	claimed_shelter_code: str | None = None
	claimed_by: str | None = None

	@model_validator(mode="before")
	@classmethod
	def _legacy_defaults(cls, data: object) -> object:
		"""Readable legacy pets: missing status → open; missing pet_id stays None until mint."""
		if not isinstance(data, dict):
			return data
		if data.get("status") is None and "status" not in data:
			data = {**data, "status": "open"}
		elif data.get("status") is None:
			data = {**data, "status": "open"}
		return data

	def effective_status(self) -> PetStatus:
		return self.status or "open"

	def is_open(self) -> bool:
		return self.effective_status() == "open"


class UnassignedHousehold(BaseModel):
	"""Household-level housing / residence / pets (CR-112 aligned)."""

	housing_type: HousingType | None = None
	residence_landmark: str | None = None
	# CR-148 — structured dorm address (housing_type apartment_dorm only).
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
	pets: list[UnassignedPet] = Field(default_factory=list)
	label: str | None = None


class UnassignedRegistration(Document):
	"""Central-queue household document — Mongo SoR until claim births Couch."""

	model_config = ConfigDict(populate_by_name=True)

	id: str = Field(alias="_id")
	schema_v: int = UNASSIGNED_SCHEMA_V
	reserved_household_id: str
	members: list[UnassignedMember]
	household: UnassignedHousehold
	status: DocumentStatus = "open"
	registered_via: RegisteredVia
	created_at: datetime
	# Denormalized open-member identity keys for unique multikey indexes.
	# Maintained on write so claimed/cancelled members drop out of uniqueness
	# (member-scoped partial unique indexes cannot filter per array element).
	open_person_id_numbers: list[str] = Field(default_factory=list)
	open_phones: list[str] = Field(default_factory=list)

	class Settings:
		name = "unassigned_registrations"
		indexes = [
			IndexModel(
				[("open_person_id_numbers", ASCENDING)],
				unique=True,
				partialFilterExpression={"open_person_id_numbers.0": {"$exists": True}},
				name="uniq_open_person_id_numbers",
			),
			IndexModel(
				[("open_phones", ASCENDING)],
				unique=True,
				partialFilterExpression={"open_phones.0": {"$exists": True}},
				name="uniq_open_phones",
			),
			IndexModel([("created_at", ASCENDING)], name="by_created_at"),
			IndexModel([("members.status", ASCENDING)], name="by_member_status"),
			IndexModel([("household.pets.status", ASCENDING)], name="by_pet_status"),
			IndexModel([("status", ASCENDING)], name="by_document_status"),
		]

	def has_open_rows(self) -> bool:
		if any(m.status == "open" for m in self.members):
			return True
		return any(p.is_open() for p in self.household.pets or [])

	def derived_document_status(self) -> Literal["open", "closed"]:
		return "open" if self.has_open_rows() else "closed"
