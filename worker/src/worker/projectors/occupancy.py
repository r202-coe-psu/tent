"""Aggregate `evacuee` docs → occupancy total + demographic breakdown (EXT-005, ADR 0002 §2).

Headcount source is `IN_SHELTER_STATUSES` (`active` + `room_confirmed`) — the same
in-shelter definition the staff app uses (`frontend/.../shared/domain/in-shelter.ts`,
#593), so partner numbers match the staff dashboard (decision sync 2026-11-02).
`arriving` / `pre_registered` are not yet checked in and `temporary_leave` is away, so
none of them count here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, TypedDict

#: Physically in the shelter — mirrors the staff app's `IN_SHELTER_STATUSES`.
IN_SHELTER_STATUSES = frozenset({"active", "room_confirmed"})
CHILD_UNDER_5_MAX_AGE = 4
ELDERLY_MIN_AGE = 60

# `special_needs` is intentionally free-form (CR-046, no code-side whitelist) — these
# are the canonical strings the rest of the system already writes/reads (schema.md
# §4.2 `target_restrictions.vulnerable_groups`), matched case-insensitively.
_PREGNANT_TAGS = {"pregnant"}
_BEDRIDDEN_TAGS = {"bedridden"}
_DISABLED_TAGS = {"disabled"}


BIRTH_YEAR_ERA_OFFSET = 543  # ค.ศ. → พ.ศ.
MIN_VALID_AGE = 0
MAX_VALID_AGE = 130


def resolve_age(doc: dict[str, Any]) -> float | None:
    """Registration only ever stores `age` when staff type it in directly (CR-057) —
    every evacuee otherwise carries `birth_year` (พ.ศ.), so that's the field to fall
    back to rather than reporting every occupant as "unknown".

    A staff typo (negative `age`, or a `birth_year` in the future / implausibly far
    in the past) must not silently project as a valid bracket — reject out-of-range
    values here instead of letting `compute_age_range` bucket them."""
    age = doc.get("age")
    if (
        isinstance(age, (int, float))
        and not isinstance(age, bool)
        and MIN_VALID_AGE <= age <= MAX_VALID_AGE
    ):
        return age

    birth_year = doc.get("birth_year")
    if isinstance(birth_year, (int, float)) and not isinstance(birth_year, bool):
        current_year_be = datetime.now(UTC).year + BIRTH_YEAR_ERA_OFFSET
        calculated_age = current_year_be - birth_year
        if MIN_VALID_AGE <= calculated_age <= MAX_VALID_AGE:
            return calculated_age

    return None


class OccupancyBreakdownDict(TypedDict):
    male: int
    female: int
    gender_unspecified: int
    child_under_5: int
    elderly_over_60: int
    pregnant: int
    bedridden: int
    disabled: int


def _empty_breakdown() -> OccupancyBreakdownDict:
    return {
        "male": 0,
        "female": 0,
        "gender_unspecified": 0,
        "child_under_5": 0,
        "elderly_over_60": 0,
        "pregnant": 0,
        "bedridden": 0,
        "disabled": 0,
    }


def aggregate_occupancy(
    evacuee_docs: list[dict[str, Any]],
) -> tuple[int, OccupancyBreakdownDict]:
    """Returns ``(occupancy_total, breakdown)`` for one shelter's in-shelter evacuees."""
    breakdown = _empty_breakdown()
    total = 0

    for doc in evacuee_docs:
        if doc.get("type") != "evacuee":
            continue
        current_stay = doc.get("current_stay") or {}
        if current_stay.get("status") not in IN_SHELTER_STATUSES:
            continue

        total += 1

        gender = doc.get("gender")
        if gender == "male":
            breakdown["male"] += 1
        elif gender == "female":
            breakdown["female"] += 1
        else:
            # null / missing key / legacy 'other' → ไม่ระบุเพศ (decision sync 2026-10-09).
            # Keeps male + female + gender_unspecified == occupancy_total.
            breakdown["gender_unspecified"] += 1

        age = resolve_age(doc)
        if age is not None:
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


def count_stay_statuses(evacuee_docs: list[dict[str, Any]]) -> dict[str, int]:
    """``current_stay.status`` -> count for one shelter's evacuees (PDPA D8).

    Ignores ``privacy`` on purpose: search-excluded evacuees have no ``public_persons``
    row but still count in public occupancy aggregates.
    """
    counts: dict[str, int] = {}
    for doc in evacuee_docs:
        if doc.get("type") != "evacuee":
            continue
        status = (doc.get("current_stay") or {}).get("status")
        if isinstance(status, str) and status:
            counts[status] = counts.get(status, 0) + 1
    return counts


def count_zone_stay_statuses(
    evacuee_docs: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    """``current_stay.zone`` -> ``current_stay.status`` -> count for one shelter's evacuees
    (draft-public-zone-occupancy, #1241).

    Keeps every status so the API picks the Present set without a re-projection when the
    definition changes. Evacuees with no zone are skipped; zone codes are not checked
    against the shelter's ``zones[]`` here — the API joins on read. Ignores ``privacy`` for
    the same reason as `count_stay_statuses`.
    """
    counts: dict[str, dict[str, int]] = {}
    for doc in evacuee_docs:
        if doc.get("type") != "evacuee":
            continue
        stay = doc.get("current_stay") or {}
        zone = stay.get("zone")
        status = stay.get("status")
        if not (isinstance(zone, str) and zone and isinstance(status, str) and status):
            continue
        by_status = counts.setdefault(zone, {})
        by_status[status] = by_status.get(status, 0) + 1
    return counts
