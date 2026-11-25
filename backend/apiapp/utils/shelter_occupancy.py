"""Shelter head-counts read from the worker's projected per-status counts.

The public occupancy triple (CR-112) and the partner EXT-002/003 `occupancy_forecast` /
`capacity_available` / per-zone `present` (decision sync 2026-11-24) share these status sets.
Kitchen/SOP and the partner EXT-005 `occupancy_total` stay In-shelter only and do not use them.

Every helper reads projected fields only (`occupancy_by_status` / `occupancy_by_zone`), never
`raw_data` or `public_persons`, so a list of 200 rows costs no extra query.
"""

from __future__ import annotations

from tent_model.public_shelter import PublicShelter

FORECAST_OCCUPANCY_STATUSES = (
    "pre_registered",
    "kiosk_registered",
    "arriving",
    "active",
    "room_confirmed",
    "temporary_leave",
)
PRESENT_OCCUPANCY_STATUSES = ("active", "room_confirmed", "temporary_leave")
IN_ZONE_OCCUPANCY_STATUSES = ("room_confirmed",)


def occupancy_forecast(doc: PublicShelter) -> int | None:
    """Forecast head-count; `None` when the row predates `occupancy_by_status` (not re-projected).

    A deactivated shelter's last counts are not current, so it reads as 0 (as the public detail).
    """
    if doc.occupancy_by_status is None:
        return None
    by_status = doc.occupancy_by_status if doc.is_active else {}
    return sum(by_status.get(status, 0) for status in FORECAST_OCCUPANCY_STATUSES)


def capacity_available(doc: PublicShelter) -> int | None:
    """`capacity` minus the Forecast, floored at 0. `None` for an external shelter (its capacity
    and head-count are not tracked here, CR-252) or when the Forecast is unknown."""
    if doc.is_external:
        return None
    forecast = occupancy_forecast(doc)
    if forecast is None:
        return None
    return max(0, doc.capacity - forecast)


def zone_present(doc: PublicShelter, zone_code: str | None) -> int | None:
    """Present head-count of one zone (#1241); `None` when the row predates `occupancy_by_zone`."""
    if doc.occupancy_by_zone is None:
        return None
    by_zone = doc.occupancy_by_zone if doc.is_active else {}
    counts = by_zone.get(zone_code, {}) if zone_code else {}
    return sum(counts.get(status, 0) for status in PRESENT_OCCUPANCY_STATUSES)
