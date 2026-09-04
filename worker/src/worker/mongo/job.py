"""Apply volunteer job / application projections to MongoDB."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from tent_model.public_job import PublicJob
from tent_model.public_job_application import PublicJobApplication
from tent_model.public_shift_assignment import PublicShiftAssignment
from tent_model.public_volunteer import PublicVolunteer
from tent_model.volunteer_job_slot import (
    VolunteerJobShiftSlot,
    seed_job_shift_slot,
    seed_job_slot,
    shift_slot_id,
)

from worker.mongo.upsert import apply_document


async def apply_job(
    action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]
) -> None:
    await apply_document(PublicJob, action, payload)
    if action != "upsert" or not payload:
        return
    # Keep the atomic head-count ceiling in step with the posting. Seeding here rather
    # than in the projector keeps the projector a pure function of the doc.
    await seed_job_slot(
        job_id=str(payload["_id"]),
        shelter_code=str(payload.get("shelter_code") or ""),
        quota=int(payload.get("quota") or 0),
        now=datetime.now(UTC),
    )
    for shift in payload.get("shifts") or []:
        shift_id = str(shift.get("shift_id") or "")
        if not shift_id:
            continue
        await seed_job_shift_slot(
            job_id=str(payload["_id"]),
            shift_id=shift_id,
            shelter_code=str(payload.get("shelter_code") or ""),
            quota=int(shift.get("quota") or 0),
            confirmed_qty=int(shift.get("slots_confirmed") or 0),
            dispatched_qty=int(shift.get("slots_dispatched") or 0),
            now=datetime.now(UTC),
        )


async def apply_job_application(
    action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]
) -> None:
    await apply_document(PublicJobApplication, action, payload)


async def apply_shift_assignment(
    action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]
) -> None:
    previous = None
    if action == "delete" and payload.get("_id"):
        previous = await PublicShiftAssignment.get(payload["_id"])
    await apply_document(PublicShiftAssignment, action, payload)
    if action == "upsert":
        job_id = payload.get("job_id")
        shift_id = payload.get("shift_id")
    else:
        job_id = previous.job_id if previous else None
        shift_id = previous.shift_id if previous else None
    if job_id and shift_id:
        await sync_job_shift_slot(
            job_id=str(job_id),
            shift_id=str(shift_id),
        )


async def sync_job_shift_slot(*, job_id: str, shift_id: str) -> None:
    """Reconcile a public shift counter with the projected assignment roster.

    Public applications reserve the counter in FastAPI; back-office assignments
    arrive through CouchDB. Re-reading the assignment projection here makes both
    write paths converge on the same per-shift read model and keeps retries
    idempotent. The sets also protect the count from duplicate assignment rows.
    """
    job = await PublicJob.get(job_id)
    if not job:
        return
    shift = next((item for item in job.shifts if item.shift_id == shift_id), None)
    if not shift:
        return
    assignments = await PublicShiftAssignment.find(
        {"job_id": job_id, "shift_id": shift_id}
    ).to_list()
    applications = await PublicJobApplication.find(
        {"job_id": job_id, "shift_id": shift_id, "status": "confirmed"}
    ).to_list()
    confirmed_ids: set[str] = set()
    dispatched_ids: set[str] = set()
    for assignment in assignments:
        if assignment.status not in {"assigned", "standby", "checked_in"}:
            continue
        if assignment.dispatch_status == "dispatched":
            dispatched_ids.add(assignment.volunteer_id)
        else:
            confirmed_ids.add(assignment.volunteer_id)
    confirmed_ids -= dispatched_ids
    # Public applications reserve the same counter before their CouchDB projection
    # exists. Include them here so a later back-office assignment projection does not
    # overwrite those reservations. Use the application id when an old projection has
    # no volunteer link; it is still one confirmed application, not zero.
    confirmed_ids.update(app.volunteer_id or app.id for app in applications)
    counter = await VolunteerJobShiftSlot.get(shift_slot_id(job_id, shift_id))
    if counter:
        counter.confirmed_qty = len(confirmed_ids)
        counter.dispatched_qty = len(dispatched_ids)
        counter.updated_at = datetime.now(UTC)
        await counter.save()


async def apply_volunteer(
    action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]
) -> None:
    await apply_document(PublicVolunteer, action, payload)
