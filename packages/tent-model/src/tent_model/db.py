"""MongoDB / Beanie initialization."""

from __future__ import annotations

from urllib.parse import urlparse

from motor.motor_asyncio import AsyncIOMotorClient

from tent_model.donation_buffer import DonationBuffer
from tent_model.public_donation import PublicDonation
from tent_model.public_need import PublicNeed
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.retention_audit import RetentionAudit
from tent_model.sync_checkpoint import SyncCheckpoint

ALL_DOCUMENTS = [
	SyncCheckpoint,
	PublicShelter,
	PublicPerson,
	PublicDonation,
	PublicNeed,
	DonationBuffer,
	RetentionAudit,
]

_client: AsyncIOMotorClient | None = None


def _database_name(mongodb_uri: str) -> str:
	path = urlparse(mongodb_uri).path.lstrip("/")
	name = path.split("?")[0] if path else ""
	if not name:
		msg = "MONGODB_URI must include a database name, e.g. mongodb://localhost:27017/tentdb"
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
