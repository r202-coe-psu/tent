"""Tests for EXT-007 occupant projector."""

from __future__ import annotations

from datetime import UTC, datetime

from worker.projectors.occupant import (
    compute_age_range,
    mask_occupant_name,
    project_shelter_occupant,
    resolve_age,
)

_CURRENT_YEAR_BE = datetime.now(UTC).year + 543


def test_compute_age_range():
    assert compute_age_range(None) == "unknown"
    assert compute_age_range("invalid") == "unknown"
    assert compute_age_range(0) == "<1"
    assert compute_age_range(0.5) == "<1"
    assert compute_age_range(1) == "1-5"
    assert compute_age_range(5) == "1-5"
    assert compute_age_range(6) == "6-11"
    assert compute_age_range(11) == "6-11"
    assert compute_age_range(12) == "12-19"
    assert compute_age_range(19) == "12-19"
    assert compute_age_range(20) == "20-59"
    assert compute_age_range(59) == "20-59"
    assert compute_age_range(60) == "60+"
    assert compute_age_range(85) == "60+"
    assert compute_age_range(-5) == "unknown"


def test_resolve_age_prefers_direct_age():
    assert resolve_age({"age": 30, "birth_year": _CURRENT_YEAR_BE - 80}) == 30


def test_resolve_age_falls_back_to_birth_year():
    assert resolve_age({"birth_year": _CURRENT_YEAR_BE - 40}) == 40


def test_resolve_age_none_when_no_age_data():
    assert resolve_age({}) is None
    assert resolve_age({"birth_year": "invalid"}) is None


def test_resolve_age_none_for_negative_direct_age():
    assert resolve_age({"age": -5}) is None


def test_resolve_age_none_for_future_birth_year():
    assert resolve_age({"birth_year": _CURRENT_YEAR_BE + 1}) is None


def test_resolve_age_none_for_implausibly_old_birth_year():
    assert resolve_age({"birth_year": _CURRENT_YEAR_BE - 200}) is None


def test_resolve_age_none_for_boolean_age_or_birth_year():
    assert resolve_age({"age": True}) is None
    assert resolve_age({"birth_year": False}) is None


def test_resolve_age_falls_back_to_birth_year_when_direct_age_invalid():
    assert resolve_age({"age": -5, "birth_year": _CURRENT_YEAR_BE - 40}) == 40


def test_mask_occupant_name():
    assert mask_occupant_name("สมชาย", "ใจดี") == "สมชาย ใ."
    assert mask_occupant_name("John", "Doe") == "John D."
    assert mask_occupant_name("สมชาย", "") == "สมชาย"
    assert mask_occupant_name("", "ใจดี") == "ใจดี"
    assert mask_occupant_name(None, None) == "ไม่ระบุชื่อ"


def test_project_shelter_occupant_active():
    doc = {
        "_id": "evacuee:01HXYZ1234567890ABCDEF",
        "type": "evacuee",
        "first_name": "สมชาย",
        "last_name": "ใบบุญ",
        "age": 65,
        "gender": "male",
        "special_needs": ["bedridden", "Bedridden", "diabetic"],
        "current_stay": {
            "status": "active",
            "since": "2026-08-10T18:40:00Z",
        },
    }
    payload = project_shelter_occupant(doc, "SH001")
    assert payload is not None
    assert payload["_id"] == "SH001:01HXYZ1234567890ABCDEF"
    assert payload["shelter_code"] == "SH001"
    assert payload["occupant_ref"] == "OCC-01HXYZ1234567890ABCDEF"
    assert payload["name_masked"] == "สมชาย ใ."
    assert payload["age_range"] == "60+"
    assert payload["gender"] == "male"
    assert payload["care_flags"] == ["bedridden", "diabetic"]
    assert payload["checked_in_at"] is not None


def test_project_shelter_occupant_falls_back_to_birth_year():
    doc = {
        "_id": "evacuee:03",
        "type": "evacuee",
        "first_name": "สมหญิง",
        "last_name": "ดีใจ",
        "birth_year": _CURRENT_YEAR_BE - 65,
        "gender": "female",
        "current_stay": {"status": "active", "since": "2026-08-10T18:40:00Z"},
    }
    payload = project_shelter_occupant(doc, "SH001")
    assert payload is not None
    assert payload["age_range"] == "60+"


def test_project_shelter_occupant_unknown_without_age_or_birth_year():
    doc = {
        "_id": "evacuee:04",
        "type": "evacuee",
        "current_stay": {"status": "active", "since": "2026-08-10T18:40:00Z"},
    }
    payload = project_shelter_occupant(doc, "SH001")
    assert payload is not None
    assert payload["age_range"] == "unknown"


def test_project_shelter_occupant_skips_inactive():
    doc = {
        "_id": "evacuee:02",
        "type": "evacuee",
        "current_stay": {"status": "checked_out"},
    }
    assert project_shelter_occupant(doc, "SH001") is None


def test_project_shelter_occupant_skips_non_evacuee():
    doc = {
        "_id": "donation:01",
        "type": "donation",
    }
    assert project_shelter_occupant(doc, "SH001") is None
