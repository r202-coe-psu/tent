"""Project CouchDB ``shift_assignment`` docs into the public schedule read model."""

from __future__ import annotations

import datetime
import re
from typing import Any, Literal

from dateutil.parser import isoparse

from worker.masking import phone_hash, sha256_hex

Action = Literal["upsert", "delete", "ignore"]

#: Shift states the volunteer's own schedule shows. A cancelled assignment is dropped
#: rather than greyed out: it is no longer something they are expected to turn up for,
#: and leaving it on the list is how people show up to a shift that was withdrawn.
PUBLIC_SHIFT_STATUSES = frozenset(
    {"assigned", "standby", "checked_in", "completed", "done", "no_show"}
)


def _ts(value: Any) -> datetime.datetime | None:
    if not value:
        return None
    try:
        return isoparse(str(value))
    except (ValueError, TypeError):
        return None


def _normalize_code(value: str) -> str:
    """Mirror of ``apiapp.utils.response_code.normalize_response_code``.

    Both sides must agree byte for byte or the hash never matches; kept as a two-line
    copy rather than a shared package because the worker does not depend on the API.
    """
    return re.sub(r"[\s-]+", "", value).upper()


def project_shift_assignment(
    doc: dict[str, Any],
    *,
    shelter_code: str,
    volunteer: dict[str, Any] | None = None,
) -> tuple[Action, dict[str, Any]]:
    """``shift_assignment:{ulid}`` → ``public_shift_assignments`` (schema.md §2.9).

    ``volunteer`` is the assignee's profile document, fetched by the caller so this
    stays a pure function. It is the only source of ``phone_hash``, which is what lets
    the Access Portal answer "what am I on for" from a phone number — including for a
    volunteer a manager assigned directly, who never filed an application.
    """
    doc_id = doc.get("_id")
    if not doc_id:
        return "ignore", {}
    if doc.get("_deleted"):
        return "delete", {"_id": doc_id}
    if doc.get("type") != "shift_assignment":
        return "ignore", {}

    status = str(doc.get("status") or "assigned")
    if status not in PUBLIC_SHIFT_STATUSES:
        return "delete", {"_id": doc_id}

    window = doc.get("duty_window") or {}
    profile = volunteer or {}
    # Prefer the hash the profile already carries; fall back to hashing the number so a
    # profile written before `phone_hash` existed still resolves.
    hashed = profile.get("phone_hash") or phone_hash(profile.get("phone"))

    # The manager reads this code down the phone, so staff need it in the clear on the
    # CouchDB document. Only its hash crosses into the public plane — a collection the
    # public API reads must not hold something that can answer for the volunteer.
    raw_code = doc.get("response_code")
    code_hash = sha256_hex(_normalize_code(str(raw_code))) if raw_code else None

    payload = {
        "_id": doc_id,
        "shelter_code": shelter_code,
        "job_id": str(doc.get("job_id") or ""),
        "volunteer_id": str(doc.get("volunteer_id") or ""),
        "phone_hash": hashed,
        "response_code_hash": code_hash,
        "date": str(doc.get("date") or ""),
        "shift": str(doc.get("shift") or ""),
        "station": str(doc.get("station") or ""),
        "duty_window": {
            "start_ts": _ts(window.get("start_ts")),
            "end_ts": _ts(window.get("end_ts")),
        },
        "check_in_at": _ts(doc.get("check_in_at")),
        "check_out_at": _ts(doc.get("check_out_at")),
        "status": status,
        "dispatch_status": doc.get("dispatch_status"),
        "updated_at": _ts(doc.get("updated_at")) or datetime.datetime.now(datetime.UTC),
    }
    return "upsert", payload
