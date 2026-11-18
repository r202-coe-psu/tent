"""Project shelter evacuee docs → shelter_occupants (EXT-007, ADR 0002 §6).

Copies occupant data in plaintext for the authorized partner read plane (CR-257) — the API
masks it for `occupancy-pii-read` and returns it whole only with `pii-full`.
Only evacuees in the shelter (`IN_SHELTER_STATUSES`: `active` + `room_confirmed`) are
projected, and never one
with `privacy.search_excluded` (opt-out / basic consent, #791) — they still count in
the EXT-005 occupancy aggregates.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from worker.projectors.evacuee import project_person_id
from worker.projectors.occupancy import IN_SHELTER_STATUSES, resolve_age


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def compute_age_range(age: float | None) -> str:
    """Categorizes an age into demographic brackets aligning with EXT-005."""
    if age is None:
        return "unknown"
    try:
        val = float(age)
    except ValueError, TypeError:
        return "unknown"

    if val < 0:
        return "unknown"
    if val < 1:
        return "<1"
    if val < 6:
        return "1-5"
    if val < 12:
        return "6-11"
    if val < 20:
        return "12-19"
    if val < 60:
        return "20-59"
    return "60+"


def _project_id(person_id: dict[str, Any] | None) -> dict[str, str | None]:
    """Plaintext ID fields only — `shelter_occupants` is listed by shelter, never searched."""
    ids = project_person_id(person_id)
    return {key: ids[key] for key in ("national_id", "passport_id", "id_card_type")}


def project_shelter_occupant(
    doc: dict[str, Any], shelter_code: str
) -> dict[str, Any] | None:
    """Projects an in-shelter evacuee doc to a ShelterOccupant payload.

    Returns None if the doc is not an in-shelter evacuee or is search-excluded;
    `refresh_shelter_occupants` then purges any existing row for it.
    """
    if doc.get("type") != "evacuee":
        return None

    doc_id = str(doc.get("_id") or "")
    if not doc_id:
        return None

    privacy = doc.get("privacy") or {}
    if privacy.get("search_excluded") is True:
        return None

    current_stay = doc.get("current_stay") or {}
    if current_stay.get("status") not in IN_SHELTER_STATUSES:
        return None

    raw_id = doc_id.replace("evacuee:", "")
    occupant_ref = f"OCC-{raw_id}"[:32]

    age = resolve_age(doc)
    age_range = compute_age_range(age)
    gender = doc.get("gender")

    special_needs = doc.get("special_needs") or []
    care_flags = sorted(
        {str(tag).strip().lower() for tag in special_needs if tag and str(tag).strip()}
    )

    checked_in_at = _parse_datetime(current_stay.get("since"))
    now = datetime.now(UTC)

    return {
        "_id": f"{shelter_code}:{raw_id}",
        "shelter_code": shelter_code,
        "occupant_ref": occupant_ref,
        "first_name": doc.get("first_name") or None,
        "last_name": doc.get("last_name") or None,
        "age": int(age) if age is not None else None,
        **_project_id(doc.get("person_id")),
        "phone": doc.get("phone") or None,
        "age_range": age_range,
        "gender": gender,
        "care_flags": care_flags,
        "checked_in_at": checked_in_at,
        "updated_at": now,
    }
