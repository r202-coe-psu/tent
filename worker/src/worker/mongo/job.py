"""Apply volunteer job / application projections to MongoDB."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from tent_model.public_job import PublicJob
from tent_model.public_job_application import PublicJobApplication
from tent_model.public_shift_assignment import PublicShiftAssignment
from tent_model.public_volunteer import PublicVolunteer
from tent_model.volunteer_job_slot import seed_job_slot

from worker.mongo.upsert import apply_document


async def apply_job(action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]) -> None:
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


async def apply_job_application(
    action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]
) -> None:
    await apply_document(PublicJobApplication, action, payload)


async def apply_shift_assignment(
    action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]
) -> None:
    await apply_document(PublicShiftAssignment, action, payload)


async def apply_volunteer(
    action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]
) -> None:
    await apply_document(PublicVolunteer, action, payload)
