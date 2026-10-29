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


def test_project_donation_carries_the_per_line_review():
    """CR-174 FR-27 / AC-18 — items_declared[] mirrors each line's review."""
    doc = _donation(
        schema_v=7,
        status="verifying",
        items=[
            {
                "item_id": "item:rice",
                "free_text": "ข้าวสาร",
                "qty": "5",
                "unit": "kg",
                "review_status": "approved",
            },
            {
                "free_text": "ผ้าห่ม",
                "qty": "2",
                "unit": "ผืน",
                "review_status": "rejected",
                "review_reason_code": "damaged",
                "review_reason": "ขาดหลายจุด",
            },
        ],
    )

    _, payload = project_donation(doc, shelter_code="SH001")

    assert payload is not None
    first, second = payload["items_declared"]
    assert first["review_status"] == "approved"
    assert first["review_reason_code"] is None
    assert first["review_reason"] is None
    assert second["review_status"] == "rejected"
    assert second["review_reason_code"] == "damaged"
    assert second["review_reason"] == "ขาดหลายจุด"


def test_project_donation_pre_v7_lines_have_no_review():
    _, payload = project_donation(_donation(schema_v=6), shelter_code="SH001")

    assert payload is not None
    line = payload["items_declared"][0]
    assert line["review_status"] is None
    assert line["review_reason_code"] is None
    assert line["review_reason"] is None


def test_project_donation_carries_the_line_key():
    """CR-196 FR-LK-3 / FR-LK-8 — GET hands the key back for the edit form."""
    doc = _donation(
        schema_v=8,
        status="pending_review",
        items=[
            {"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน", "line_key": "01K8KEYA"},
            {"free_text": "ผ้าห่ม", "qty": "1", "unit": "ผืน", "line_key": "01K8KEYB"},
        ],
    )

    _, payload = project_donation(doc, shelter_code="SH001")

    assert payload is not None
    assert [line["line_key"] for line in payload["items_declared"]] == [
        "01K8KEYA",
        "01K8KEYB",
    ]


def test_project_donation_pre_v8_lines_have_no_line_key():
    _, payload = project_donation(_donation(schema_v=7), shelter_code="SH001")

    assert payload is not None
    assert payload["items_declared"][0]["line_key"] is None


def test_project_donation_never_carries_donor_photos():
    # CR-175 FR-14: no public read path for donor photos — they may show faces or plates.
    _, payload = project_donation(
        _donation(
            schema_v=9,
            status="pending_review",
            photos=["image:01K8PHXTX00000000000000001"],
        ),
        shelter_code="SH001",
    )

    assert payload is not None
    assert "photos" not in payload
    assert "image:" not in repr(payload)
