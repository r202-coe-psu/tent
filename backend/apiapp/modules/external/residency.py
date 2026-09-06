"""External shelter-residency mapping (CR-112 additive Present / In-zone)."""

from __future__ import annotations

from typing import Literal

# Present Occupancy — CHECKED_IN binary for legacy clients.
PRESENT_RESIDENCY_STATUSES = frozenset({"active", "room_confirmed", "temporary_leave"})

ResidencyBinary = Literal["CHECKED_IN", "CHECKED_OUT"]


def map_shelter_residency(stay_status: str) -> tuple[ResidencyBinary, str, bool]:
    """Map projected stay status to binary + additive fields.

    Returns ``(status, stay_status, in_zone)`` where ``status`` stays
    ``CHECKED_IN|CHECKED_OUT`` for legacy clients, ``stay_status`` is the raw
    stay value, and ``in_zone`` is true only for Zone Arrival Confirmation.
    """
    binary: ResidencyBinary = (
        "CHECKED_IN" if stay_status in PRESENT_RESIDENCY_STATUSES else "CHECKED_OUT"
    )
    in_zone = stay_status == "room_confirmed"
    return binary, stay_status, in_zone
