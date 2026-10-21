"""project_donation → public_donations (CR-172 reject reasons)."""

from worker.projectors.donation import project_donation


def _donation(**overrides):
    doc = {
        "_id": "donation:01TEST",
        "type": "donation",
        "schema_v": 6,
        "shelter_code": "SH001",
        "tracking_token_hash": "hash-1",
        "booking_ref": "DN-123456",
        "status": "rejected",
        "items": [{"free_text": "นมกล่อง", "qty": "10", "unit": "กล่อง"}],
        "updated_at": "2026-10-21T03:00:00.000Z",
    }
    doc.update(overrides)
    return doc


def test_project_donation_carries_reject_reason_and_code():
    action, payload = project_donation(
        _donation(
            reject_reason="หมดอายุ — กล่องนมหมดอายุ 2 กล่อง",
            reject_reason_code="expired",
        ),
        shelter_code="SH001",
    )

    assert action == "upsert"
    assert payload is not None
    assert payload["reject_reason"] == "หมดอายุ — กล่องนมหมดอายุ 2 กล่อง"
    assert payload["reject_reason_code"] == "expired"


def test_project_donation_passes_rejected_lines_through_received_summary():
    summary = {
        "total_items": 2,
        "received_at": "2026-10-21T03:00:00.000Z",
        "shortfalls": [],
        "items": [
            {"item_id": "item:rice", "qty": "5", "unit": "ถุง"},
            {
                "free_text": "นมกล่อง",
                "qty": "0",
                "unit": "กล่อง",
                "rejected": True,
                "reject_reason": "ชำรุด — กล่องบุบ",
                "reject_reason_code": "damaged",
            },
        ],
    }
    _, payload = project_donation(
        _donation(status="received", received_summary=summary), shelter_code="SH001"
    )

    assert payload is not None
    assert payload["received_summary"] == summary
    # A partial receipt keeps the doc-level reason empty — the reason is per line.
    assert payload["reject_reason"] is None
    assert payload["reject_reason_code"] is None


def test_project_donation_pre_v6_doc_has_no_reason():
    legacy = _donation(schema_v=5)

    _, payload = project_donation(legacy, shelter_code="SH001")

    assert payload is not None
    assert payload["status"] == "rejected"
    assert payload["reject_reason"] is None
    assert payload["reject_reason_code"] is None
