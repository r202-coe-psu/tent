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

_FLAG_PATH = "raw_data.feature_flags.accepts_pre_registration"


def accepts_pre_registration(raw: dict[str, Any]) -> bool:
    """The staff switch alone (public plane): only an explicit `True` counts."""
    flags = raw.get("feature_flags") or {}
    return flags.get("accepts_pre_registration") is True


def accepts_booking(doc: PublicShelter) -> bool:
    """The normal booking rule: not closed AND the pre-registration switch is on."""
    return doc.location_status != "closed" and accepts_pre_registration(doc.raw_data)


def accepts_booking_query(value: bool) -> dict[str, Any]:
    """Mongo filter equivalent of `accepts_booking(doc) is value` (for EXT-002 pagination)."""
    if value:
        return {"location_status": {"$ne": "closed"}, _FLAG_PATH: True}
    return {"$or": [{"location_status": "closed"}, {_FLAG_PATH: {"$ne": True}}]}
