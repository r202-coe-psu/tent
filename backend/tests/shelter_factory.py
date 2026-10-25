"""Shared `PublicShelter` builder for the partner API tests (#751 `accepts_booking` rule).

One builder for EXT-002/003 (`accepts_booking`) and EXT-008 (bookability / bypass) tests, so the
two files cannot drift on what "bookable" means: location_status != "closed" AND
raw_data.feature_flags.accepts_pre_registration is True (a missing flag is NOT bookable).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from tent_model.public_shelter import PublicShelter


def flag_raw(value: bool | None) -> dict[str, Any]:
    """`raw_data` with the pre-registration flag set, or without any `feature_flags` at all."""
    if value is None:
        return {}
    return {"feature_flags": {"accepts_pre_registration": value}}


# A shelter staff switched "accepts pre-registration" ON for: bookable by the normal rule.
BOOKABLE_RAW: dict[str, Any] = flag_raw(True)


async def insert_shelter(
    code: str = "SH001",
    *,
    status: str = "open",
    is_active: bool = True,
    raw_data: dict[str, Any] | None = None,
) -> PublicShelter:
    """Default raw_data = the pre-registration flag ON (#751: a missing flag is NOT bookable).

    Pass `raw_data={}` for the flag-missing case, or an explicit `feature_flags` for False.
    """
    return await PublicShelter(
        id=code,
        shelter_code=code,
        name=f"ศูนย์ {code}",
        status=status,
        location_status=status,
        is_active=is_active,
        capacity=100,
        raw_data=BOOKABLE_RAW if raw_data is None else raw_data,
        updated_at=datetime.now(UTC),
    ).insert()
