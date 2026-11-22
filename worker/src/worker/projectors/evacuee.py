"""Project shelter evacuee docs → public_persons.

CR-257: the row carries plaintext PII (surname, ID number, phone, address) — masking moved to
the API, which decides per endpoint/scope what to expose. Search keys stay hashes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from worker.masking import (
    last_name_hash,
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


_ID_TYPES_IN_NATIONAL_SLOT = frozenset({"national_id", "pink_card", "other"})

_ADDRESS_FIELDS = (
    "address_no",
    "village_no",
    "subdistrict",
    "district",
    "province",
    "postal_code",
)


def project_person_id(person_id: dict[str, Any] | None) -> dict[str, str | None]:
    """ID number + its search hash. `pink_card` / `other` share the national-ID slot (and
    hash) so a 13-digit public search still finds them; `id_card_type` tells them apart."""
    empty: dict[str, str | None] = {
        "national_id": None,
        "national_id_hash": None,
        "passport_id": None,
        "passport_hash": None,
        "id_card_type": None,
    }
    if not person_id:
        return empty

    number = person_id.get("number")
    card_type = person_id.get("cardType", "national_id")
    if not number or not isinstance(number, str):
        return empty

    if card_type == "passport":
        return {
            **empty,
            "passport_id": number,
            "passport_hash": passport_hash(number),
            "id_card_type": "passport",
        }

    if card_type in _ID_TYPES_IN_NATIONAL_SLOT:
        return {
            **empty,
            "national_id": number,
            "national_id_hash": national_id_hash(number),
            "id_card_type": card_type,
        }

    return empty


def _project_address(household: dict[str, Any] | None) -> dict[str, str | None] | None:
    if not household:
        return None
    return {field: household.get(field) or None for field in _ADDRESS_FIELDS}


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
        _parse_datetime(updated_raw)
        if isinstance(updated_raw, str)
        else datetime.now(UTC)
    )

    last_name = doc.get("last_name") or ""
    id_fields = project_person_id(doc.get("person_id"))

    payload: dict[str, Any] = {
        "_id": doc_id,
        "shelter_code": shelter_code,
        "first_name": doc.get("first_name") or "",
        "first_name_key": name_key(doc.get("first_name") or ""),
        "last_name": last_name,
        "last_name_hash": last_name_hash(last_name),
        "phone": doc.get("phone") or None,
        "phone_hash": phone_hash(doc.get("phone")),
        "gender": doc.get("gender"),
        "address": _project_address(household),
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
    return ("upsert", payload)
