"""Inbound loop — persist public volunteer applications into CouchDB.

Mirrors ``inbound.donations``: FastAPI writes a buffer row, this loop turns it into the
shelter's system-of-record documents and flips ``synced_to_couch``. Two docs come out of
one application (CR-092 FR-VOL-01):

* ``volunteer:{ulid}`` — the person's central profile, so a returning volunteer is one
  profile applying twice rather than two people.
* ``job_application:{ulid}`` — this application, carrying the tracking token hash the
  Digital Pass is reached by.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from tent_model.volunteer_application_buffer import VolunteerApplicationBuffer

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name

logger = logging.getLogger(__name__)

#: Matches the donation loop. The applicant is already looking at their ticket by now —
#: this only decides how soon the shelter's own screens see them.
POLL_INTERVAL_SECONDS = 3


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _volunteer_doc(
    application: VolunteerApplicationBuffer, *, now: str
) -> dict[str, Any]:
    applicant = application.applicant
    return {
        "_id": application.volunteer_id,
        "type": "volunteer",
        # Shift identity belongs to the application/assignment, not the profile.
        "schema_v": 1,
        "shelter_code": application.shelter_code,
        "created_at": _iso(application.created_at),
        "updated_at": now,
        "created_by": "public",
        "first_name": applicant.first_name,
        "last_name": applicant.last_name,
        "phone": applicant.phone,
        "phone_hash": applicant.phone_hash,
        "national_id": applicant.national_id,
        "national_id_hash": applicant.national_id_hash,
        "email": applicant.email,
        "skills": list(applicant.skills),
        "tracking_token": None,
        "status": "active",
        "user_name": None,
        # A volunteer applying at a second shelter reuses this id, which is what makes
        # the profile central (D-MULTI=A) rather than one row per shelter.
        "central_profile_id": application.volunteer_id,
        "checked_in": False,
        "current_shelter_code": None,
    }


def _application_doc(
    application: VolunteerApplicationBuffer, *, now: str
) -> dict[str, Any]:
    applicant = application.applicant
    shift = application.selected_shift
    shift_id = application.shift_id or shift.shift_id
    return {
        "_id": application.id,
        "type": "job_application",
        "schema_v": 3,
        "shelter_code": application.shelter_code,
        "created_at": _iso(application.created_at),
        "updated_at": now,
        "created_by": "public",
        "job_id": application.job_id,
        "volunteer_id": application.volunteer_id,
        "shift_id": shift_id,
        "applicant": {
            "first_name": applicant.first_name,
            "last_name": applicant.last_name,
            "phone": applicant.phone,
            "phone_hash": applicant.phone_hash,
            "national_id": applicant.national_id,
            "email": applicant.email,
            "skills": list(applicant.skills),
        },
        "selected_shift": {
            "shift_id": shift_id,
            "date": shift.date,
            "start_time": shift.start_time,
            "end_time": shift.end_time,
            "station": shift.station,
        },
        # Only the hash. The raw token is the applicant's bearer credential for the
        # ticket; the shelter has no use for it and storing it would make every staff
        # read of the doc a way to open someone's pass.
        "tracking_token_hash": application.tracking_token_hash,
        "status": application.status,
        "review_notes": None,
        "reviewed_at": None,
        "reviewed_by": None,
        "source": "public",
    }


async def _persist_application(
    couch: CouchClient, application: VolunteerApplicationBuffer
) -> bool:
    database = shelter_db_name(application.shelter_code)
    if not await couch.database_exists(database):
        logger.warning(
            "Shelter database %s missing for volunteer application %s",
            database,
            application.id,
        )
        return False

    now = _iso(datetime.now(UTC))

    # Profile first. If the application landed and the profile did not, the shelter
    # would hold an application pointing at a volunteer_id that resolves to nothing;
    # the other way round leaves an orphan profile, which the next poll completes.
    try:
        existing_profile = await couch.get_doc(database, application.volunteer_id)
        if existing_profile is None:
            await couch.put_doc(database, _volunteer_doc(application, now=now))
    except Exception:
        logger.exception("Failed to persist volunteer profile for %s", application.id)
        return False

    try:
        result = await couch.put_doc(database, _application_doc(application, now=now))
    except Exception:
        logger.exception("Failed to persist volunteer application %s", application.id)
        return False

    if not result.get("ok"):
        logger.error(
            "CouchDB put for volunteer application %s did not acknowledge ok: %s",
            application.id,
            result,
        )
        return False

    application.synced_to_couch = True
    # The ID number has reached the system of record; the buffer has no further use for
    # it and every extra hour it sits in Mongo is PDPA exposure for nothing (NFR-20).
    application.applicant.national_id = None
    await application.save()
    logger.info("Persisted volunteer application %s to %s", application.id, database)
    return True


async def run_volunteer_inbound_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    while not stop_event.is_set():
        try:
            pending = await VolunteerApplicationBuffer.find(
                VolunteerApplicationBuffer.synced_to_couch == False
            ).to_list()
            for application in pending:
                if stop_event.is_set():
                    break
                await _persist_application(couch, application)
        except Exception:
            logger.exception("Inbound volunteer application poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
