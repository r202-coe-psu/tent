"""Project shelter evacuee docs → public_persons."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from worker.masking import (
    mask_address,
    mask_last_name,
    mask_national_id,
    mask_passport,
    national_id_hash,
    passport_hash,
    phone_hash,
)

ProjectionAction = Literal["upsert", "delete"]


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _project_person_id(person_id: dict[str, Any] | None) -> dict[str, str | None]:
    if not person_id:
        return {
            "national_id_hash": None,
            "national_id_masked": None,
            "passport_hash": None,
            "passport_id_masked": None,
        }

    number = person_id.get("number")
    card_type = person_id.get("cardType", "national_id")
    if not number or not isinstance(number, str):
        return {
            "national_id_hash": None,
            "national_id_masked": None,
            "passport_hash": None,
            "passport_id_masked": None,
        }

    if card_type == "passport":
        return {
            "national_id_hash": None,
            "national_id_masked": None,
            "passport_hash": passport_hash(number),
            "passport_id_masked": mask_passport(number),
        }

    if card_type == "national_id":
        return {
            "national_id_hash": national_id_hash(number),
            "national_id_masked": mask_national_id(number),
            "passport_hash": None,
            "passport_id_masked": None,
        }

    # pink_card / other — hash into national_id_hash so 13-digit (and
    # normalized) public search still finds the person.
    if card_type in {"pink_card", "other"}:
        return {
            "national_id_hash": national_id_hash(number),
            "national_id_masked": mask_national_id(number),
            "passport_hash": None,
            "passport_id_masked": None,
        }

    return {
        "national_id_hash": None,
        "national_id_masked": None,
        "passport_hash": None,
        "passport_id_masked": None,
    }


def project_evacuee(
    doc: dict[str, Any],
    *,
    shelter_code: str,
    household: dict[str, Any] | None = None,
) -> tuple[ProjectionAction, dict[str, Any] | None]:
    if doc.get("type") != "evacuee":
        return ("delete", None)

    doc_id = doc.get("_id")
    if not doc_id:
        return ("delete", None)

    privacy = doc.get("privacy") or {}
    if privacy.get("search_excluded") is True:
        return ("delete", {"_id": doc_id})

    current_stay = doc.get("current_stay") or {}
    status = current_stay.get("status") or "unknown"

    updated_raw = doc.get("updated_at") or doc.get("created_at")
    updated_at = (
        _parse_datetime(updated_raw) if isinstance(updated_raw, str) else datetime.now(UTC)
    )

    last_name = doc.get("last_name") or ""
    id_fields = _project_person_id(doc.get("person_id"))

    payload: dict[str, Any] = {
        "_id": doc_id,
        "shelter_code": shelter_code,
        "first_name": doc.get("first_name") or "",
        "last_name_masked": mask_last_name(last_name),
        "phone_hash": phone_hash(doc.get("phone")),
        "gender": doc.get("gender"),
        "address_masked": mask_address(household),
        "checked_in_at": _parse_datetime(current_stay.get("since")),
        "care_zone": current_stay.get("zone"),
        "household_id": doc.get("household_id"),
        "search_excluded": False,
        "status": status,
        "updated_at": updated_at,
        **id_fields,
    }
    return ("upsert", payload)
