"""CR-231 S0 — audit event registry validation (no DB needed)."""

import pytest
from tent_model.audit_event import validate_payload

PAYLOAD = {
	"query_kind": "phone",
	"query_hash": "h",
	"result_count": 1,
	"searcher": {"first_name": "สมชาย", "last_name": "", "phone": "0812345678"},
	"purpose": "find_family",
	"consent_version": "search-v1",
}


def test_public_search_valid():
	out = validate_payload("public.search", PAYLOAD)
	assert out["purpose"] == "find_family"
	assert out["searcher"]["last_name"] == ""
	assert "purpose_note" not in out


def test_purpose_note_kept_when_present():
	payload = {**PAYLOAD, "purpose": "other", "purpose_note": "หาญาติ"}
	out = validate_payload("public.search", payload)
	assert out["purpose_note"] == "หาญาติ"


@pytest.mark.parametrize("missing", ["purpose", "consent_version", "searcher", "query_hash"])
def test_public_search_requires_field(missing):
	with pytest.raises(ValueError):
		validate_payload("public.search", {k: v for k, v in PAYLOAD.items() if k != missing})


def test_unknown_event_type_rejected():
	with pytest.raises(ValueError):
		validate_payload("public.serch", PAYLOAD)


def test_unknown_payload_key_rejected():
	with pytest.raises(ValueError):
		validate_payload("public.search", {**PAYLOAD, "client_ip": "203.0.113.10"})


def test_invalid_purpose_rejected():
	with pytest.raises(ValueError):
		validate_payload("public.search", {**PAYLOAD, "purpose": "curious"})
