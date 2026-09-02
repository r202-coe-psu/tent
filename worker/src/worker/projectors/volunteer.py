"""Project CouchDB ``volunteer`` docs into the public profile read model."""

from __future__ import annotations

import datetime
from typing import Any, Literal

from dateutil.parser import isoparse

from worker.masking import mask_phone, phone_hash

Action = Literal["upsert", "delete", "ignore"]


def _ts(value: Any) -> datetime.datetime | None:
    if not value:
        return None
    try:
        return isoparse(str(value))
    except (ValueError, TypeError):
        return None


def project_volunteer(
    doc: dict[str, Any], *, shelter_code: str
) -> tuple[Action, dict[str, Any]]:
    """``volunteer:{ulid}`` → ``public_volunteers`` (schema.md §2.8).

    Feeds the Access Portal's own profile screen. The projection is deliberately
    narrower than the document: ``national_id``, the raw ``phone``, ``user_name`` and
    ``tracking_token`` never cross into the public plane, so a read there cannot leak
    them regardless of what the API asks for.

    An ``inactive`` profile is dropped rather than projected as inactive — a volunteer
    a shelter has stood down should not keep a live public profile, and the portal
    answers "no profile" the same way it answers an unknown phone number.
    """
    doc_id = doc.get("_id")
    if not doc_id:
        return "ignore", {}
    if doc.get("_deleted"):
        return "delete", {"_id": doc_id}
    if doc.get("type") != "volunteer":
        return "ignore", {}
    if str(doc.get("status") or "active") != "active":
        return "delete", {"_id": doc_id}

    payload = {
        "_id": doc_id,
        "shelter_code": shelter_code,
        # Prefer the hash the document already carries; fall back to hashing the number
        # so a profile written before `phone_hash` existed still resolves.
        "phone_hash": doc.get("phone_hash") or phone_hash(doc.get("phone")),
        "first_name": str(doc.get("first_name") or ""),
        "last_name": str(doc.get("last_name") or ""),
        "nickname": doc.get("nickname"),
        "phone_masked": mask_phone(doc.get("phone")),
        "email": doc.get("email"),
        "volunteer_code": str(doc.get("volunteer_code") or ""),
        "skills": [str(s) for s in (doc.get("skills") or [])],
        "organization": doc.get("organization"),
        "identity_verified": bool(doc.get("identity_verified")),
        "personnel_type": str(doc.get("personnel_type") or "volunteer"),
        "status": str(doc.get("status") or "active"),
        "updated_at": _ts(doc.get("updated_at")) or datetime.datetime.now(datetime.UTC),
    }
    return "upsert", payload
