"""Audited single-document deletes on the public plane (`_retention_audit`)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from tent_model import RetentionAudit

# "scheduled": the retention loop. "shelter_closed": CDC (processor or bootstrap) saw
# the shelter close and dropped its operational rows right away (CR-183 FR-4).
AuditTrigger = Literal["scheduled", "shelter_closed"]


async def audit_and_delete(
    *,
    job_run_id: str,
    trigger: AuditTrigger,
    model: type,
    target_id: str,
    couchdb_ref: dict | None = None,
) -> None:
    audit_id = f"retention:{uuid.uuid4().hex}"
    audit = RetentionAudit(
        id=audit_id,
        job_run_id=job_run_id,
        trigger=trigger,
        target_collection=model.Settings.name,
        target_id=target_id,
        couchdb_ref=couchdb_ref,
        action="delete_one",
        status="pending",
        created_at=datetime.now(UTC),
    )
    await audit.insert()

    existing = await model.get(target_id)
    deleted_count = 0
    if existing:
        await existing.delete()
        deleted_count = 1

    remaining = await model.get(target_id)
    if remaining is None:
        audit.status = "verified"
        audit.deleted_count = deleted_count
        audit.verified_at = datetime.now(UTC)
    else:
        audit.status = "failed"
        audit.error = "Document still present after delete"
    await audit.save()
