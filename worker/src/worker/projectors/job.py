"""Project CouchDB ``job`` / ``job_application`` docs into the public read models."""

from __future__ import annotations

import datetime
from typing import Any, Literal

from dateutil.parser import isoparse

from worker.masking import mask_phone, phone_hash

Action = Literal["upsert", "delete", "ignore"]

#: Job statuses a member of the public may see on the board. ``draft`` never leaves the
#: shelter, and closed/cancelled postings are pulled rather than shown greyed out —
#: schema.md §2.17 plus CR-092 screen 1, which filters on เปิดรับ / ใกล้เต็ม only.
PUBLIC_JOB_STATUSES = frozenset({"open", "almost_full", "full"})


def _updated_at(doc: dict[str, Any]) -> datetime.datetime:
    raw = doc.get("updated_at")
    if not raw:
        return datetime.datetime.now(datetime.UTC)
    try:
        return isoparse(raw)
    except (ValueError, TypeError):
        return datetime.datetime.now(datetime.UTC)


def _int(value: Any, default: int = 0) -> int:
    # bool is an int subclass and a stray `true` would silently mean "1 slot".
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def project_job(doc: dict[str, Any], *, shelter_code: str) -> tuple[Action, dict[str, Any]]:
    """``job:{ulid}`` → ``public_jobs`` (schema.md §2.17, CR-092 FR-VOL-06)."""
    doc_id = doc.get("_id")
    if not doc_id:
        return "ignore", {}
    if doc.get("_deleted"):
        return "delete", {"_id": doc_id}
    if doc.get("type") != "job":
        return "ignore", {}

    status = str(doc.get("status") or "open")
    # Withdrawing a posting has to remove the row, not stop updating it: an upsert-only
    # projector would leave the last open snapshot on the board forever.
    if status not in PUBLIC_JOB_STATUSES:
        return "delete", {"_id": doc_id}

    quota = _int(doc.get("quota"))
    confirmed = _int(doc.get("slots_confirmed"))
    dispatched = _int(doc.get("slots_dispatched"))
    # Recomputed rather than copied. `slots_remaining` is a derived field on a doc staff
    # edit by hand (CR-092 §1.1), and the board must never advertise more room than the
    # quota actually leaves.
    remaining = max(quota - confirmed - dispatched, 0)

    template = doc.get("shift_template") or {}
    payload = {
        "_id": doc_id,
        "shelter_code": shelter_code,
        "title": str(doc.get("title") or ""),
        "description": str(doc.get("description") or ""),
        "tier": str(doc.get("tier") or "operational"),
        "skills_required": [str(s) for s in (doc.get("skills_required") or [])],
        "quota": quota,
        "slots_confirmed": confirmed,
        "slots_dispatched": dispatched,
        "slots_remaining": remaining,
        "shift_template": {
            "shift_name": str(template.get("shift_name") or ""),
            "start_time": str(template.get("start_time") or ""),
            "end_time": str(template.get("end_time") or ""),
            "days": [str(d) for d in (template.get("days") or [])],
        },
        "auto_accept": bool(doc.get("auto_accept", False)),
        "status": status,
        "updated_at": _updated_at(doc),
    }
    return "upsert", payload


def project_job_application(
    doc: dict[str, Any], *, shelter_code: str
) -> tuple[Action, dict[str, Any]]:
    """``job_application:{ulid}`` → ``public_job_applications`` (schema.md §2.18).

    Drops ``national_id`` and the raw phone on the way out: the Digital Pass may show
    neither (FR-VOL-03.4), so they never reach a collection a public route can read.
    """
    doc_id = doc.get("_id")
    if not doc_id:
        return "ignore", {}
    if doc.get("_deleted"):
        return "delete", {"_id": doc_id}
    if doc.get("type") != "job_application":
        return "ignore", {}

    token_hash = doc.get("tracking_token_hash")
    if not token_hash:
        # Without it the ticket is unreachable anyway, and a row with no hash would
        # answer every `find_one(tracking_token_hash=None)` lookup.
        return "ignore", {}

    applicant = doc.get("applicant") or {}
    shift = doc.get("selected_shift") or {}
    phone = applicant.get("phone")

    payload = {
        "_id": doc_id,
        "shelter_code": shelter_code,
        "job_id": str(doc.get("job_id") or ""),
        "tracking_token_hash": str(token_hash),
        "phone_hash": applicant.get("phone_hash") or phone_hash(phone),
        "applicant": {
            "first_name": str(applicant.get("first_name") or ""),
            "last_name": str(applicant.get("last_name") or ""),
            "phone_masked": mask_phone(phone),
            "skills": [str(s) for s in (applicant.get("skills") or [])],
        },
        "selected_shift": {
            "date": str(shift.get("date") or ""),
            "start_time": str(shift.get("start_time") or ""),
            "end_time": str(shift.get("end_time") or ""),
            "station": shift.get("station"),
        },
        "status": str(doc.get("status") or "pending_review"),
        "updated_at": _updated_at(doc),
    }
    return "upsert", payload
