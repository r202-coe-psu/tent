"""Integration-style tests for projector → API field contract."""

from worker.masking import mask_last_name, national_id_hash
from worker.projectors.evacuee import project_evacuee


def test_projected_evacuee_supports_family_search_lookup():
    doc = {
        "_id": "evacuee:integration",
        "type": "evacuee",
        "first_name": "ทดสอบ",
        "last_name": "ระบบ",
        "phone": "0812345678",
        "person_id": {"cardType": "national_id", "number": "3900100244192"},
        "current_stay": {"status": "active", "zone": "General", "since": "2026-01-01T00:00:00.000Z"},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    _, payload = project_evacuee(doc, shelter_code="SH001")
    assert payload is not None
    assert payload["national_id_hash"] == national_id_hash("3900100244192")
    assert payload["last_name_masked"] == mask_last_name("ระบบ")
    assert payload["status"] == "active"
