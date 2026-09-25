"""Regression test for CR-107 PR review 1.2 — `sync_job_shift_slot` must not wipe a
confirmed public application's quota reservation while it is still waiting on the
inbound worker to sync its `VolunteerApplicationBuffer` row into CouchDB.
"""

from datetime import UTC, datetime

from tent_model.public_job import PublicJob
from tent_model.volunteer_application_buffer import (
    ApplicantBuffer,
    SelectedShiftBuffer,
    VolunteerApplicationBuffer,
)
from tent_model.volunteer_job_slot import (
    VolunteerJobShiftSlot,
    seed_job_shift_slot,
    shift_slot_id,
)

from worker.mongo.job import sync_job_shift_slot

JOB_ID = "job:01JOB"
SHIFT_ID = "sft:morning"


async def _seed_job_and_slot() -> None:
    await PublicJob(
        id=JOB_ID,
        shelter_code="SH001",
        title="ครัว",
        status="open",
        quota=5,
        slots_confirmed=0,
        slots_remaining=5,
        updated_at=datetime.now(UTC),
        shifts=[
            {
                "shift_id": SHIFT_ID,
                "date": "2026-09-10",
                "start_time": "08:00",
                "end_time": "12:00",
                "quota": 2,
                "slots_confirmed": 0,
                "slots_dispatched": 0,
                "slots_remaining": 2,
            }
        ],
    ).insert()
    await seed_job_shift_slot(
        job_id=JOB_ID,
        shift_id=SHIFT_ID,
        shelter_code="SH001",
        quota=2,
        confirmed_qty=0,
        dispatched_qty=0,
        now=datetime.now(UTC),
    )


async def test_sync_does_not_wipe_a_reservation_still_pending_couchdb_sync(db):
    await _seed_job_and_slot()

    # FastAPI already reserved the seat and wrote the buffer synchronously; the
    # inbound worker has not synced it into CouchDB (and thus PublicJobApplication) yet.
    await VolunteerApplicationBuffer(
        id="job_application:01BUF",
        shelter_code="SH001",
        job_id=JOB_ID,
        shift_id=SHIFT_ID,
        volunteer_id="volunteer:01VOL",
        applicant=ApplicantBuffer(
            first_name="A", last_name="B", phone="0812345678", phone_hash="phonehash"
        ),
        selected_shift=SelectedShiftBuffer(
            date="2026-09-10", start_time="08:00", end_time="12:00"
        ),
        tracking_token="tok",
        tracking_token_hash="tokhash",
        created_at=datetime.now(UTC),
        status="confirmed",
        synced_to_couch=False,
    ).insert()

    # A back-office assignment change on an unrelated shift fires the same
    # reconciliation path.
    await sync_job_shift_slot(job_id=JOB_ID, shift_id=SHIFT_ID)

    counter = await VolunteerJobShiftSlot.get(shift_slot_id(JOB_ID, SHIFT_ID))
    assert counter is not None
    assert counter.confirmed_qty == 1


async def test_sync_does_not_double_count_once_the_buffer_has_synced(db):
    await _seed_job_and_slot()

    await VolunteerApplicationBuffer(
        id="job_application:01BUF",
        shelter_code="SH001",
        job_id=JOB_ID,
        shift_id=SHIFT_ID,
        volunteer_id="volunteer:01VOL",
        applicant=ApplicantBuffer(
            first_name="A", last_name="B", phone="0812345678", phone_hash="phonehash"
        ),
        selected_shift=SelectedShiftBuffer(
            date="2026-09-10", start_time="08:00", end_time="12:00"
        ),
        tracking_token="tok",
        tracking_token_hash="tokhash",
        created_at=datetime.now(UTC),
        status="confirmed",
        synced_to_couch=True,
    ).insert()

    await sync_job_shift_slot(job_id=JOB_ID, shift_id=SHIFT_ID)

    counter = await VolunteerJobShiftSlot.get(shift_slot_id(JOB_ID, SHIFT_ID))
    assert counter is not None
    assert counter.confirmed_qty == 0
