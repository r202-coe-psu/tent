"""Mongo SoR for Unassigned Registration (CR-113) — not a Couch projection."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ASCENDING, IndexModel

from tent_model.public_shelter import GeoPoint

MemberStatus = Literal["open", "claimed", "cancelled"]
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
	gender: Literal["male", "female", "other"]
	phone: str | None = None
	person_id: PersonId | None = None
	country: str = "THAILAND"
	vulnerable_groups: list[str] = Field(default_factory=list)
	special_needs: list[str] = Field(default_factory=list)
	birth_year: int | None = None
	age: int | None = None
	nickname: str | None = None
	religion: str | None = None
	emergency_contact: EmergencyContact | None = None
	# GridFS ref while queued (`gfs:{oid}`); claim births Couch `image:{ulid}` (#255).
	photo: str | None = None
	# Claim metadata (CR-113 algorithm — optional until claimed).
	claimed_at: datetime | None = None
	claimed_shelter_code: str | None = None
	claimed_by: str | None = None


class UnassignedPet(BaseModel):
	species: PetSpecies
	count: int = 1
	notes: str | None = None
	has_cage: bool = False
	# GridFS ref while queued (`gfs:{oid}`); claim births Couch `image:{ulid}` (#255 pet photo).
	image_url: str | None = None


class UnassignedHousehold(BaseModel):
	"""Household-level housing / residence / pets (CR-112 aligned)."""

	housing_type: HousingType | None = None
	residence_landmark: str | None = None
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
	schema_v: int = 1
	reserved_household_id: str
	members: list[UnassignedMember]
	household: UnassignedHousehold
	status: MemberStatus = "open"
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
		]
