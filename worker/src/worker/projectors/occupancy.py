"""Aggregate `evacuee` docs → occupancy total + demographic breakdown (EXT-005, ADR 0002 §2).

Headcount source is `current_stay.status == 'active'` — the same physically-present
definition CR-035 uses for `daily_calc.occupancy_snapshot` (arriving/pre_registered
evacuees are not yet checked in, so they are not counted here either).
"""

from __future__ import annotations

from typing import Any, TypedDict

ACTIVE_STATUS = "active"
CHILD_UNDER_5_MAX_AGE = 4
ELDERLY_MIN_AGE = 60

# `special_needs` is intentionally free-form (CR-046, no code-side whitelist) — these
# are the canonical strings the rest of the system already writes/reads (schema.md
# §4.2 `target_restrictions.vulnerable_groups`), matched case-insensitively.
_PREGNANT_TAGS = {"pregnant"}
_BEDRIDDEN_TAGS = {"bedridden"}
_DISABLED_TAGS = {"disabled"}


class OccupancyBreakdownDict(TypedDict):
    male: int
    female: int
    child_under_5: int
    elderly_over_60: int
    pregnant: int
    bedridden: int
    disabled: int


def _empty_breakdown() -> OccupancyBreakdownDict:
    return {
        "male": 0,
        "female": 0,
        "child_under_5": 0,
        "elderly_over_60": 0,
        "pregnant": 0,
        "bedridden": 0,
        "disabled": 0,
    }


def aggregate_occupancy(
    evacuee_docs: list[dict[str, Any]],
) -> tuple[int, OccupancyBreakdownDict]:
    """Returns ``(occupancy_total, breakdown)`` for one shelter's active evacuees."""
    breakdown = _empty_breakdown()
    total = 0

    for doc in evacuee_docs:
        if doc.get("type") != "evacuee":
            continue
        current_stay = doc.get("current_stay") or {}
        if current_stay.get("status") != ACTIVE_STATUS:
            continue

        total += 1

        gender = doc.get("gender")
        if gender == "male":
            breakdown["male"] += 1
        elif gender == "female":
            breakdown["female"] += 1

        age = doc.get("age")
        if isinstance(age, (int, float)):
            if age <= CHILD_UNDER_5_MAX_AGE:
                breakdown["child_under_5"] += 1
            if age >= ELDERLY_MIN_AGE:
                breakdown["elderly_over_60"] += 1

        tags = {
            str(tag).strip().lower() for tag in (doc.get("special_needs") or []) if tag
        }
        if tags & _PREGNANT_TAGS:
            breakdown["pregnant"] += 1
        if tags & _BEDRIDDEN_TAGS:
            breakdown["bedridden"] += 1
        if tags & _DISABLED_TAGS:
            breakdown["disabled"] += 1

    return total, breakdown
