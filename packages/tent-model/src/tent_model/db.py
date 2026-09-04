"""MongoDB / Beanie initialization."""

from __future__ import annotations

from urllib.parse import urlparse

from motor.motor_asyncio import AsyncIOMotorClient

from tent_model.api_key import ApiKey
from tent_model.donation_buffer import DonationBuffer
from tent_model.donation_need_counter import DonationNeedCounter
from tent_model.public_announcement import PublicAnnouncement
from tent_model.public_donation import PublicDonation
from tent_model.public_job import PublicJob
from tent_model.public_job_application import PublicJobApplication
from tent_model.public_need import PublicNeed
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.public_shift_assignment import PublicShiftAssignment
from tent_model.public_volunteer import PublicVolunteer
from tent_model.retention_audit import RetentionAudit
from tent_model.search_audit import SearchAudit
from tent_model.shift_response_buffer import ShiftResponseBuffer
from tent_model.sync_checkpoint import SyncCheckpoint
from tent_model.volunteer_application_buffer import VolunteerApplicationBuffer
from tent_model.volunteer_job_slot import (
	VolunteerJobShiftSlot,
	VolunteerJobSlot,
)
from tent_model.volunteer_profile_update_buffer import VolunteerProfileUpdateBuffer

ALL_DOCUMENTS = [
	SyncCheckpoint,
	PublicShelter,
	PublicPerson,
	PublicDonation,
	PublicNeed,
	DonationBuffer,
	DonationNeedCounter,
	RetentionAudit,
	SearchAudit,
	PublicAnnouncement,
	ApiKey,
	PublicJob,
	PublicJobApplication,
	VolunteerApplicationBuffer,
	VolunteerJobSlot,
	VolunteerJobShiftSlot,
	PublicShiftAssignment,
	ShiftResponseBuffer,
	PublicVolunteer,
	VolunteerProfileUpdateBuffer,
]

_client: AsyncIOMotorClient | None = None


def _database_name(mongodb_uri: str) -> str:
	path = urlparse(mongodb_uri).path.lstrip("/")
	name = path.split("?")[0] if path else ""
	if not name:
		msg = "DATABASE_URI must include a database name, e.g. mongodb://localhost:27017/tentdb"
		raise ValueError(msg)
	return name


async def init_db(mongodb_uri: str) -> None:
	global _client
	from beanie import init_beanie

	_client = AsyncIOMotorClient(mongodb_uri)
	database = _client[_database_name(mongodb_uri)]
	await init_beanie(database=database, document_models=ALL_DOCUMENTS)


async def close_db() -> None:
	global _client
	if _client is not None:
		_client.close()
		_client = None
