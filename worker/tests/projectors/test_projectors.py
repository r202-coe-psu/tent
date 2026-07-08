import hashlib

from worker.masking import mask_last_name, phone_hash, sha256_hex, shelter_code_from_db_name
from worker.projectors.evacuee import project_evacuee
from worker.projectors.shelter import is_shelter_open, project_shelter


def test_sha256_hex_matches_frontend_contract():
    assert sha256_hex("0811111111") == hashlib.sha256(b"0811111111").hexdigest()


def test_mask_last_name_long_thai():
    assert mask_last_name("ประเสริฐ") == "ปร****ริฐ"


def test_mask_last_name_short():
    assert mask_last_name("ดี") == "ดี****"

def test_phone_hash_none_for_missing():
    assert phone_hash(None) is None


def test_shelter_code_from_db_name():
    assert shelter_code_from_db_name("shelter_sh001") == "SH001"


def test_project_shelter_v1_open():
    doc = {
        "type": "shelter",
        "code": "SH001",
        "name": "ศูนย์ทดสอบ",
        "status": "open",
        "capacity": 200,
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_shelter(doc)
    assert action == "upsert"
    assert payload is not None
    assert payload["_id"] == "SH001"
    assert payload["status"] == "open"
    assert payload["capacity"] == 200
    assert "national_id" not in payload


def test_project_shelter_closed_deletes():
    doc = {
        "type": "shelter",
        "code": "SH001",
        "name": "ศูนย์ทดสอบ",
        "operation_status": "closed",
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_shelter(doc)
    assert action == "delete"
    assert payload == {"_id": "SH001"}


def test_is_shelter_open_variants():
    assert is_shelter_open({"operation_status": "active"}) is True
    assert is_shelter_open({"status": "open"}) is True
    assert is_shelter_open({"operation_status": "closed"}) is False


def test_project_evacuee_allow_list_and_masking():
    doc = {
        "_id": "evacuee:01TEST",
        "type": "evacuee",
        "first_name": "สมชาย",
        "last_name": "ใจดี",
        "phone": "0811111111",
        "national_id": "3900101234567",
        "current_stay": {"status": "checked_in", "zone": "Z1", "since": "2026-01-01T00:00:00.000Z"},
        "privacy": {"search_excluded": False},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001")
    assert action == "upsert"
    assert payload is not None
    assert payload["first_name"] == "สมชาย"
    assert payload["last_name"] == "ใจดี"
    assert payload["phone_hash"] == sha256_hex("0811111111")
    assert "phone" not in payload
    assert "national_id" not in payload


def test_project_evacuee_search_excluded_deletes():
    doc = {
        "_id": "evacuee:01OPT",
        "type": "evacuee",
        "first_name": "ลับ",
        "last_name": "ลับ",
        "privacy": {"search_excluded": True},
        "current_stay": {"status": "checked_in"},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001")
    assert action == "delete"
    assert payload == {"_id": "evacuee:01OPT"}
