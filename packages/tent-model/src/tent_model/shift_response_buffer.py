from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import ConfigDict, Field
from pymongo import IndexModel


class ShiftResponseBuffer(Document):
	"""A volunteer's answer to a dispatched shift, awaiting persistence into CouchDB.

	Same hand-off as ``VolunteerApplicationBuffer``: the public plane cannot write to
	CouchDB, so FastAPI records the answer here and the worker's inbound loop applies it
	to ``shift_assignment:{ulid}`` in ``shelter_{code}``.

	Kept after syncing rather than deleted — it is the record of who answered and when,
	and the shelter's own document only carries the outcome.
	"""

	model_config = ConfigDict(populate_by_name=True)

	#: The ``shift_assignment:{ulid}`` being answered. One answer per assignment, which
	#: the unique id enforces: a shift already responded to cannot be responded to twice.
	id: str = Field(alias="_id")
	shelter_code: str
	job_id: str
	volunteer_id: str
	#: accepted | declined
	action: str
	responded_at: datetime
	synced_to_couch: bool = False

	class Settings:
		name = "volunteer_shift_responses"
		indexes = [IndexModel([("synced_to_couch", 1)])]
