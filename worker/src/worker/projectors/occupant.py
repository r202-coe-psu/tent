"""Project shelter evacuee docs → shelter_occupants (EXT-007, ADR 0002 §6).

Extracts and masks occupant data for authorized partner read plane with PDPA compliance.
Only active evacuees (current_stay.status == 'active') are projected.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


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

    if val < 5:
        return "0-4"
    if val < 18:
        return "5-17"
    if val < 60:
        return "18-59"
    if val < 70:
        return "60-69"
    return "70+"


def mask_occupant_name(first_name: str | None, last_name: str | None) -> str:
    """Masks name according to ODT convention (e.g. 'สมชาย ใ.')."""
    fn = (first_name or "").strip()
    ln = (last_name or "").strip()
    if not fn and not ln:
        return "ไม่ระบุชื่อ"
    if fn and ln:
        return f"{fn} {ln[0]}."
    return fn or ln


def project_shelter_occupant(
    doc: dict[str, Any], shelter_code: str
) -> dict[str, Any] | None:
    """Projects an active evacuee doc to a ShelterOccupant payload.

    Returns None if the doc is not an active evacuee.
    """
    if doc.get("type") != "evacuee":
        return None

    doc_id = str(doc.get("_id") or "")
    if not doc_id:
        return None

    current_stay = doc.get("current_stay") or {}
    if current_stay.get("status") != "active":
        return None

    raw_id = doc_id.replace("evacuee:", "")
    occupant_ref = f"OCC-{raw_id}"[:32]

    first_name = doc.get("first_name")
    last_name = doc.get("last_name")
    name_masked = mask_occupant_name(first_name, last_name)

    age_range = compute_age_range(doc.get("age"))
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
        "name_masked": name_masked,
        "age_range": age_range,
        "gender": gender,
        "care_flags": care_flags,
        "checked_in_at": checked_in_at,
        "updated_at": now,
    }
