"""Shared "does this shelter accept bookings" rule (#751).

One place for the rule behind the public `accepts_pre_registration` flag, the partner
`accepts_booking` field (EXT-002/003) and the EXT-008 bookability gate:

    accepts_booking = location_status != "closed"
                      AND raw_data.feature_flags.accepts_pre_registration is True

A missing flag is NOT bookable (same as the staff `isShelterBookable`). The flag is read from
`raw_data`, so no projection change is needed.
"""

from __future__ import annotations

from typing import Any

from tent_model.public_shelter import PublicShelter

_FLAGS_PATH = "$raw_data.feature_flags"
_FLAG_PATH = f"{_FLAGS_PATH}.accepts_pre_registration"


def accepts_pre_registration(raw: Any) -> bool:
    """The staff switch alone (public plane): only an explicit boolean `True` counts.

    Never raises: `raw_data` / `feature_flags` that is not a dict (string, list, None) or a flag
    that is not exactly `True` (1, "true", [True], ...) is simply "not accepting".
    """
    if not isinstance(raw, dict):
        return False
    flags = raw.get("feature_flags")
    if not isinstance(flags, dict):
        return False
    return flags.get("accepts_pre_registration") is True


def accepts_booking(doc: PublicShelter) -> bool:
    """The normal booking rule: not closed AND the pre-registration switch is on."""
    return doc.location_status != "closed" and accepts_pre_registration(doc.raw_data)


def _accepts_pre_registration_expr() -> dict[str, Any]:
    """Aggregation form of `accepts_pre_registration`: `feature_flags` must be an object and the
    flag a strict boolean `true`. A plain `{path: True}` match would also hit arrays (a list of
    flag docs, or `[True]`), which the Python helper rejects."""
    return {
        "$and": [
            {"$eq": [{"$type": _FLAGS_PATH}, "object"]},
            {"$eq": [_FLAG_PATH, True]},
        ]
    }


def accepts_booking_query(value: bool) -> dict[str, Any]:
    """Mongo filter equivalent of `accepts_booking(doc) is value` (for EXT-002 pagination)."""
    bookable: dict[str, Any] = {
        "$and": [
            {"location_status": {"$ne": "closed"}},
            {"$expr": _accepts_pre_registration_expr()},
        ]
    }
    return bookable if value else {"$nor": [bookable]}
