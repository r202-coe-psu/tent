"""Project shelter evacuee docs → public_persons."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from worker.masking import (
    last_name_hash,
    mask_address,
    mask_last_name,
    mask_national_id,
    mask_passport,
    name_key,
    national_id_hash,
    passport_hash,
    phone_hash,
)

ProjectionAction = Literal["upsert", "delete"]

#: Stay statuses with no Station 1 check-in behind them: `public_person.checked_in_at`
#: stays null so EXT-011 answers 404 instead of a past stay. Mirrors
#: `NOT_RESIDENT_STAY_STATUSES` in backend thirdparty_residency/residency.py — keep in sync.
_NOT_CHECKED_IN_STATUSES = frozenset(
    {"pre_registered", "kiosk_registered", "cancelled"}
)


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


#: Fields a search-excluded person keeps: just enough for EXT-008's duplicate check
#: (FR-17/20) and EXT-009/010's stay reads (decision sync 2026-10-26).
_HOLD_FIELDS = frozenset(
    {"_id", "shelter_code", "national_id_hash", "status", "updated_at"}
)
#: Non-nullable on `PublicPerson`; blanked to "" instead of None.
_REQUIRED_STR_FIELDS = frozenset({"first_name", "first_name_key", "last_name_masked"})


def _hold_only(payload: dict[str, Any]) -> dict[str, Any]:
    """Blank every other field. `apply_document` merges key by key, so each key must be
    sent blank, or a person who opts out would keep the PII projected before."""
    hold = {
        key: value
        if key in _HOLD_FIELDS
        else ("" if key in _REQUIRED_STR_FIELDS else None)
        for key, value in payload.items()
    }
    hold["search_excluded"] = True
    return hold


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

    current_stay = doc.get("current_stay") or {}
    status = current_stay.get("status") or "unknown"

    updated_raw = doc.get("updated_at") or doc.get("created_at")
    updated_at = (
        _parse_datetime(updated_raw)
        if isinstance(updated_raw, str)
        else datetime.now(UTC)
    )

    last_name = doc.get("last_name") or ""
    id_fields = _project_person_id(doc.get("person_id"))

    payload: dict[str, Any] = {
        "_id": doc_id,
        "shelter_code": shelter_code,
        "first_name": doc.get("first_name") or "",
        "first_name_key": name_key(doc.get("first_name") or ""),
        "last_name_masked": mask_last_name(last_name),
        "last_name_hash": last_name_hash(last_name),
        "phone_hash": phone_hash(doc.get("phone")),
        "gender": doc.get("gender"),
        "address_masked": mask_address(household),
        # These statuses have not completed Station 1 check-in yet. A stale
        # `since` value must not make any of them appear resident externally.
        # `cancelled` is only reachable from `pre_registered` / `kiosk_registered`
        # (partner EXT-009 cancel, staff cancelPreRegistration), so its `since` is the
        # cancel time, never a check-in time (#710, CR-176).
        "checked_in_at": (
            None
            if status in _NOT_CHECKED_IN_STATUSES
            else _parse_datetime(current_stay.get("since"))
        ),
        "care_zone": current_stay.get("zone"),
        "household_id": doc.get("household_id"),
        "search_excluded": False,
        "status": status,
        "updated_at": updated_at,
        **id_fields,
    }
    if (doc.get("privacy") or {}).get("search_excluded") is True:
        return ("upsert", _hold_only(payload))
    return ("upsert", payload)
