from tent_model.volunteer_identity import (
    candidate_conflicts,
    merge_profile,
    normalize_phone,
    phone_hash,
)


def test_phone_matching_uses_one_canonical_representation() -> None:
    assert normalize_phone("+66 81-234-5678") == "0812345678"
    assert phone_hash("+66812345678") == phone_hash("0812345678")


def test_profile_merge_preserves_verified_identity_and_skill() -> None:
    existing = {
        "_id": "volunteer:existing",
        "identity_verified": True,
        "identity_verification": {"status": "verified", "reviewed_by": "staff"},
        "skills": ["kitchen", "medical"],
        "skill_verifications": {"medical": {"status": "verified", "credential_reference": "LIC-1"}},
        "national_id": "123",
    }

    merged = merge_profile(
        existing,
        first_name="สมชาย",
        last_name="ใจดี",
        phone="0812345678",
        phone_hash_value=phone_hash("0812345678"),
        national_id=None,
        national_id_hash=None,
        email="new@example.com",
        submitted_skills=["medical", "first_aid"],
        controlled_skills=["medical", "first_aid"],
        now="2026-09-09T00:00:00Z",
    )

    assert merged["identity_verification"]["status"] == "verified"
    assert merged["identity_verified"] is True
    assert merged["skill_verifications"]["medical"] == {
        "status": "verified",
        "credential_reference": "LIC-1",
    }
    assert merged["skill_verifications"]["first_aid"]["status"] == "pending"
    assert merged["national_id"] == "123"
    assert merged["skills"] == ["kitchen", "medical", "first_aid"]


def test_candidate_conflicts_are_not_silently_merged() -> None:
    assert candidate_conflicts(
        [
            {"first_name": "A", "last_name": "B", "national_id_hash": "one"},
            {"first_name": "A", "last_name": "B", "national_id_hash": "two"},
        ]
    )
    assert not candidate_conflicts(
        [
            {"first_name": "A", "last_name": "B", "national_id_hash": "one"},
            {"first_name": "A", "last_name": "B", "national_id_hash": "one"},
        ]
    )
