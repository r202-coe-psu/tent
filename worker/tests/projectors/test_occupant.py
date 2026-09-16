"""Tests for EXT-007 occupant projector."""

from __future__ import annotations

from worker.projectors.occupant import (
    compute_age_range,
    mask_occupant_name,
    project_shelter_occupant,
)


def test_compute_age_range():
    assert compute_age_range(None) == "unknown"
    assert compute_age_range("invalid") == "unknown"
    assert compute_age_range(0) == "0-4"
    assert compute_age_range(4) == "0-4"
    assert compute_age_range(5) == "5-17"
    assert compute_age_range(17) == "5-17"
    assert compute_age_range(18) == "18-59"
    assert compute_age_range(59) == "18-59"
    assert compute_age_range(60) == "60-69"
    assert compute_age_range(69) == "60-69"
    assert compute_age_range(70) == "70+"
    assert compute_age_range(85) == "70+"


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
    assert payload["age_range"] == "60-69"
    assert payload["gender"] == "male"
    assert payload["care_flags"] == ["bedridden", "diabetic"]
    assert payload["checked_in_at"] is not None


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
