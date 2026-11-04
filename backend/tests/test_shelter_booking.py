"""`accepts_pre_registration` / `accepts_booking` helper (#751, CR-182).

Only an exact boolean `True` counts; malformed `raw_data` / `feature_flags` never raises, and the
Mongo filter used by EXT-002 pagination agrees with the Python helper on every shape.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from shelter_factory import insert_shelter
from tent_model.public_shelter import PublicShelter

from apiapp.utils.shelter_booking import (
    accepts_booking,
    accepts_booking_query,
    accepts_pre_registration,
)

# (id, raw_data) pairs that must NOT count as "accepting pre-registration".
NOT_ACCEPTING: list[tuple[str, Any]] = [
    ("raw-none", None),
    ("raw-string", "feature_flags"),
    ("raw-list", [{"feature_flags": {"accepts_pre_registration": True}}]),
    ("raw-int", 1),
    ("raw-empty", {}),
    ("flags-missing", {"other": 1}),
    ("flags-none", {"feature_flags": None}),
    ("flags-string", {"feature_flags": "yes"}),
    ("flags-list-of-docs", {"feature_flags": [{"accepts_pre_registration": True}]}),
    ("flags-list-of-strings", {"feature_flags": ["accepts_pre_registration"]}),
    ("flags-int", {"feature_flags": 1}),
    ("flag-missing", {"feature_flags": {}}),
    ("flag-false", {"feature_flags": {"accepts_pre_registration": False}}),
    ("flag-none", {"feature_flags": {"accepts_pre_registration": None}}),
    ("flag-int-1", {"feature_flags": {"accepts_pre_registration": 1}}),
    ("flag-string-true", {"feature_flags": {"accepts_pre_registration": "true"}}),
    ("flag-string-yes", {"feature_flags": {"accepts_pre_registration": "yes"}}),
    ("flag-list-true", {"feature_flags": {"accepts_pre_registration": [True]}}),
    ("flag-dict", {"feature_flags": {"accepts_pre_registration": {"v": True}}}),
]
ACCEPTING: list[tuple[str, Any]] = [
    ("flag-true", {"feature_flags": {"accepts_pre_registration": True}}),
    ("flag-true-extra", {"feature_flags": {"accepts_pre_registration": True, "x": False}}),
]

# Shapes a stored doc can really have (`PublicShelter.raw_data` is a dict, so a non-dict
# `raw_data` is only reachable through the helper, not through a model round trip).
STORABLE = [(i, r) for i, r in NOT_ACCEPTING + ACCEPTING if isinstance(r, dict)]


@pytest.mark.parametrize("raw", [r for _, r in NOT_ACCEPTING], ids=[i for i, _ in NOT_ACCEPTING])
def test_accepts_pre_registration_is_false_and_never_raises(raw: Any) -> None:
    assert accepts_pre_registration(raw) is False


@pytest.mark.parametrize("raw", [r for _, r in ACCEPTING], ids=[i for i, _ in ACCEPTING])
def test_accepts_pre_registration_is_true_only_for_exact_true(raw: Any) -> None:
    assert accepts_pre_registration(raw) is True


@pytest.mark.parametrize("raw", [r for _, r in NOT_ACCEPTING], ids=[i for i, _ in NOT_ACCEPTING])
@pytest.mark.parametrize("location_status", ["open", "full", "closed"])
def test_accepts_booking_is_false_for_malformed_raw_data(raw: Any, location_status: str) -> None:
    doc = SimpleNamespace(location_status=location_status, raw_data=raw)
    assert accepts_booking(doc) is False  # type: ignore[arg-type]


@pytest.mark.parametrize(("location_status", "expected"), [("open", True), ("closed", False)])
def test_accepts_booking_needs_both_conditions(location_status: str, expected: bool) -> None:
    raw = {"feature_flags": {"accepts_pre_registration": True}}
    doc = SimpleNamespace(location_status=location_status, raw_data=raw)
    assert accepts_booking(doc) is expected  # type: ignore[arg-type]


@pytest.mark.parametrize("raw", [r for _, r in STORABLE], ids=[i for i, _ in STORABLE])
@pytest.mark.parametrize("location_status", ["open", "closed"])
async def test_mongo_filter_agrees_with_helper(
    client: Any, raw: dict[str, Any], location_status: str
) -> None:
    """`accepts_booking_query(True/False)` selects exactly what the helper says, per shape."""
    doc = await insert_shelter("SH777", status=location_status, raw_data=raw)
    expected = accepts_booking(doc)

    in_true = await PublicShelter.find(accepts_booking_query(True)).count()
    in_false = await PublicShelter.find(accepts_booking_query(False)).count()
    assert (in_true, in_false) == ((1, 0) if expected else (0, 1))
