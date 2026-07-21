import hashlib
from datetime import UTC, datetime

from worker.masking import (
    mask_last_name,
    mask_national_id,
    mask_passport,
    national_id_hash,
    passport_hash,
    phone_hash,
    sha256_hex,
    shelter_code_from_db_name,
)
from worker.projectors.compute_needs import compute_needs
from worker.projectors.evacuee import project_evacuee
from worker.projectors.shelter import is_shelter_open, map_public_shelter_status, project_shelter


def test_sha256_hex_matches_frontend_contract():
    assert sha256_hex("0811111111") == hashlib.sha256(b"0811111111").hexdigest()


def test_mask_last_name_long_thai():
    assert mask_last_name("ประเสริฐ") == "ปร****ริฐ"


def test_mask_last_name_short():
    assert mask_last_name("ดี") == "ดี****"


def test_mask_national_id_thirteen_digits():
    assert mask_national_id("3900100244192") == "390-XXXX-XX-192"


def test_phone_hash_none_for_missing():
    assert phone_hash(None) is None


def test_shelter_code_from_db_name():
    assert shelter_code_from_db_name("shelter_sh001") == "SH001"


def test_project_shelter_v1_open():
    doc = {
        "_id": "shelter:01TEST",
        "type": "shelter",
        "code": "SH001",
        "name": "ศูนย์ทดสอบ",
        "operation_status": "active",
        "capacity": 200,
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_shelter(doc)
    assert action == "upsert"
    assert payload is not None
    assert payload["_id"] == "SH001"
    assert payload["status"] == "open"
    assert payload["registry_id"] == "shelter:01TEST"
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


def test_map_public_shelter_status():
    assert map_public_shelter_status({"operation_status": "full_capacity"}) == "open"
    assert map_public_shelter_status({"operation_status": "closed"}) == "closed"


def test_is_shelter_open_variants():
    assert is_shelter_open({"operation_status": "active"}) is True
    assert is_shelter_open({"status": "open"}) is True
    assert is_shelter_open({"operation_status": "closed"}) is False


def test_project_evacuee_maps_person_id_and_masked_fields():
    doc = {
        "_id": "evacuee:01TEST",
        "type": "evacuee",
        "first_name": "สมชาย",
        "last_name": "ใจดี",
        "phone": "0811111111",
        "gender": "male",
        "person_id": {"cardType": "national_id", "number": "3900100244192"},
        "household_id": "household:01HH",
        "current_stay": {
            "status": "active",
            "zone": "โซนที่ General",
            "since": "2026-01-01T00:00:00.000Z",
        },
        "privacy": {"search_excluded": False},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    household = {
        "subdistrict": "หาดใหญ่",
        "district": "หาดใหญ่",
        "province": "สงขลา",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001", household=household)
    assert action == "upsert"
    assert payload is not None
    assert payload["first_name"] == "สมชาย"
    assert payload["last_name_masked"] == mask_last_name("ใจดี")
    assert payload["national_id_hash"] == national_id_hash("3900100244192")
    assert payload["national_id_masked"] == mask_national_id("3900100244192")
    assert payload["phone_hash"] == sha256_hex("0811111111")
    assert payload["gender"] == "male"
    assert payload["care_zone"] == "โซนที่ General"
    assert payload["household_id"] == "household:01HH"
    assert payload["address_masked"].startswith("**/*")
    assert "last_name" not in payload
    assert "phone" not in payload


def test_project_evacuee_passport():
    doc = {
        "_id": "evacuee:02TEST",
        "type": "evacuee",
        "first_name": "John",
        "last_name": "Doe",
        "person_id": {"cardType": "passport", "number": "AB1234567"},
        "current_stay": {"status": "pre_registered"},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001")
    assert action == "upsert"
    assert payload is not None
    assert payload["passport_hash"] == passport_hash("AB1234567")
    assert payload["passport_id_masked"] == mask_passport("AB1234567")


def test_project_evacuee_search_excluded_deletes():
    doc = {
        "_id": "evacuee:01OPT",
        "type": "evacuee",
        "first_name": "ลับ",
        "last_name": "ลับ",
        "privacy": {"search_excluded": True},
        "current_stay": {"status": "active"},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001")
    assert action == "delete"
    assert payload == {"_id": "evacuee:01OPT"}


def test_compute_needs_aggregates_campaign_minus_donations():
    campaigns = [
        {
            "_id": "donation_campaign:01",
            "needs": [{"item_id": "item:rice", "qty_target": "10"}],
        }
    ]
    donations = [
        {
            "campaign_id": "donation_campaign:01",
            "status": "declared",
            "items": [{"item_id": "item:rice", "qty": "3"}],
        }
    ]
    remaining, item_campaign = compute_needs(campaigns, donations)
    assert remaining["item:rice"] == "7.0"
    assert item_campaign["item:rice"] == "donation_campaign:01"
