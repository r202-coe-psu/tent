"""Tests for the `volunteer` → `public_volunteers` projection.

What must not happen here is a leak: the document holds an ID number, a raw phone and a
login name, and the public collection is read by an anonymous API.
"""

from worker.projectors.volunteer import project_volunteer


def _doc(**overrides) -> dict:
    doc = {
        "_id": "volunteer:01TESTVOL00000000000001",
        "type": "volunteer",
        "first_name": "สมชาย",
        "last_name": "ใจดี",
        "phone": "0812345678",
        "phone_hash": "hashed-value",
        "national_id": "1234567890123",
        "user_name": "somchai@example.com",
        "tracking_token": "TKT-VOL-SECRET",
        "skills": ["ครัว"],
        "volunteer_code": "V-001",
        "identity_verified": True,
        "status": "active",
        "updated_at": "2026-09-01T10:00:00Z",
    }
    doc.update(overrides)
    return doc


def test_it_projects_what_the_portal_needs():
    action, payload = project_volunteer(_doc(), shelter_code="SH001")
    assert action == "upsert"
    assert payload["shelter_code"] == "SH001"
    assert payload["phone_hash"] == "hashed-value"
    assert payload["skills"] == ["ครัว"]
    assert payload["identity_verified"] is True


def test_the_id_number_the_raw_phone_and_the_login_never_cross_over():
    _, payload = project_volunteer(_doc(), shelter_code="SH001")
    assert "national_id" not in payload
    assert "user_name" not in payload
    assert "tracking_token" not in payload
    assert "phone" not in payload
    assert payload["phone_masked"].endswith("5678")
    assert "0812345678" not in str(payload)


def test_a_profile_written_before_phone_hash_existed_still_resolves():
    # Without the fallback the portal answers "no profile" for a volunteer whose row
    # predates the field — the same failure the schedule projector guards against.
    _, payload = project_volunteer(_doc(phone_hash=None), shelter_code="SH001")
    assert payload["phone_hash"]


def test_a_stood_down_profile_is_removed_from_the_public_plane():
    action, payload = project_volunteer(_doc(status="inactive"), shelter_code="SH001")
    assert action == "delete"
    assert payload == {"_id": "volunteer:01TESTVOL00000000000001"}


def test_a_deleted_document_is_removed():
    action, _ = project_volunteer(_doc(_deleted=True), shelter_code="SH001")
    assert action == "delete"


def test_another_doc_type_is_ignored():
    action, _ = project_volunteer(_doc(type="evacuee"), shelter_code="SH001")
    assert action == "ignore"
