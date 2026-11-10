"""CR-231 S0 — audit event registry validation (no DB needed)."""

import pytest
from tent_model.audit_event import validate_event

CONTEXT = {
	"query_kind": "phone",
	"query_hash": "h",
	"ip_hash": "i",
	"result_count": 1,
	"purpose": "find_family",
	"consent_version": "search-v1",
}
PII = {
	"searcher": {"first_name": "สมชาย", "last_name": "", "phone": "0812345678"},
	"client_ip": "203.0.113.10",
	"purpose_note": None,
}


def build(event_type="public.search", domain="public", context=CONTEXT, pii=PII):
	return validate_event(event_type, domain, context, pii)


def test_public_search_valid():
	context, pii = build()
	assert context["purpose"] == "find_family"
	assert pii["client_ip"] == "203.0.113.10"


@pytest.mark.parametrize("missing", ["purpose", "consent_version"])
def test_public_search_requires_purpose_and_consent_version(missing):
	with pytest.raises(ValueError):
		build(context={k: v for k, v in CONTEXT.items() if k != missing})


def test_unknown_event_type_rejected():
	with pytest.raises(ValueError):
		build(event_type="public.serch")


def test_pii_keys_rejected_in_context():
	with pytest.raises(ValueError):
		build(context={**CONTEXT, "client_ip": "203.0.113.10"})


def test_public_search_requires_pii():
	with pytest.raises(ValueError):
		build(pii=None)


def test_external_search_has_no_pii():
	ctx = {k: CONTEXT[k] for k in ("query_kind", "query_hash", "ip_hash", "result_count")}
	assert build(event_type="external.search", context=ctx, pii=None)[1] is None
	with pytest.raises(ValueError):
		build(event_type="external.search", context=ctx)
