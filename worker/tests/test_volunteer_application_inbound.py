from datetime import UTC, datetime
from types import SimpleNamespace

from tent_model.volunteer_application_buffer import (
    ApplicantBuffer,
    SelectedShiftBuffer,
)

from worker.inbound.volunteer_applications import _application_doc, _volunteer_doc


def _application(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "id": "job_application:01APP",
        "shelter_code": "SH001",
        "job_id": "job:01JOB",
        "shift_id": "shift:morning",
        "volunteer_id": "volunteer:01VOL",
        "applicant": ApplicantBuffer(
            first_name="สมชาย",
            last_name="ใจดี",
            phone="0812345678",
            phone_hash="phone-hash",
            skills=["kitchen", "medical"],
        ),
        "selected_shift": SelectedShiftBuffer(
            shift_id="shift:morning",
            date="2026-09-09",
            start_time="08:00",
            end_time="12:00",
        ),
        "controlled_skills": ["medical"],
        "tracking_token": "TKT-VOL-1",
        "tracking_token_hash": "token-hash",
        "status": "pending_review",
        "review_reasons": ["skill_certification"],
        "created_at": datetime(2026, 9, 9, tzinfo=UTC),
    }
    values.update(overrides)
    return SimpleNamespace(**values)  # type: ignore[return-value]


def test_new_profile_marks_controlled_skill_pending() -> None:
    doc = _volunteer_doc(_application(), now="2026-09-09T00:00:00Z")

    assert doc["_id"] == "volunteer:01VOL"
    assert doc["identity_verification"]["status"] == "pending"
    assert doc["skill_verifications"]["medical"]["status"] == "pending"


def test_application_keeps_its_own_token_and_identity() -> None:
    doc = _application_doc(_application(), now="2026-09-09T00:00:00Z")

    assert doc["_id"] == "job_application:01APP"
    assert doc["volunteer_id"] == "volunteer:01VOL"
    assert doc["tracking_token_hash"] == "token-hash"
    assert doc["status"] == "pending_review"
