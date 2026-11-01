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


def test_project_donation_carries_each_lines_drop_off_point():
    # CR-206 FR-MP-13: the donor's ticket groups lines by point.
    _, payload = project_donation(
        _donation(
            schema_v=10,
            status="verifying",
            items=[
                {
                    "free_text": "น้ำดื่ม",
                    "qty": "24",
                    "unit": "ขวด",
                    "drop_off_point_id": "p-gym",
                },
                {
                    "free_text": "ยาพารา",
                    "qty": "10",
                    "unit": "แผง",
                    "drop_off_point_id": None,
                },
                {"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน"},
            ],
        ),
        shelter_code="SH001",
    )

    assert payload is not None
    assert [line["drop_off_point_id"] for line in payload["items_declared"]] == [
        "p-gym",
        None,
        None,
    ]
    assert payload["point_receipts"] == []


def test_project_donation_reduces_point_receipts_to_point_lines_and_time():
    # CR-206 §Change: who recorded it, their remarks and the ledger/audit ids stay staff's.
    _, payload = project_donation(
        _donation(
            schema_v=10,
            status="verifying",
            point_receipts=[
                {
                    "point_id": "p-gym",
                    "line_nos": [0],
                    "received_at": "2026-10-28T02:12:00.000Z",
                    "received_by": "gym-staff",
                    "audit_id": "audit:01SECRET",
                    "ledger_ids": ["stock_ledger:01SECRET"],
                    "items": [{"line_no": 0, "qty": "24", "unit": "ขวด"}],
                    "remarks": "ลังบุบ",
                },
                {
                    "point_id": None,
                    "line_nos": [1, 2],
                    "received_at": "2026-10-28T03:00:00.000Z",
                    "received_by": "lead",
                    "audit_id": "audit:02",
                    "ledger_ids": [],
                    "items": [],
                },
            ],
        ),
        shelter_code="SH001",
    )

    assert payload is not None
    assert payload["point_receipts"] == [
        {
            "point_id": "p-gym",
            "line_nos": [0],
            "received_at": "2026-10-28T02:12:00.000Z",
        },
        {
            "point_id": None,
            "line_nos": [1, 2],
            "received_at": "2026-10-28T03:00:00.000Z",
        },
    ]
    assert "gym-staff" not in repr(payload)
    assert "SECRET" not in repr(payload)
    assert "ลังบุบ" not in repr(payload)


def test_project_donation_never_carries_who_closed_the_booking():
    """Decision sync 2026-10-30 — ``closed_by`` is a staff name; ``closed_reason`` is not."""
    summary = {
        "total_items": 1,
        "received_at": "2026-10-28T02:12:00.000Z",
        "closed_by": "สมศรี",
        "closed_reason": "staff_close",
        "items": [{"item_id": "item:rice", "qty": "5", "unit": "ถุง"}],
    }
    _, payload = project_donation(
        _donation(status="received", received_summary=summary), shelter_code="SH001"
    )

    assert payload is not None
    assert "closed_by" not in payload["received_summary"]
    assert payload["received_summary"]["closed_reason"] == "staff_close"
    assert summary["closed_by"] == "สมศรี"


def test_project_donation_never_carries_the_point_receipts_staff_remarks():
    """CR-206 — close joins every point receipt's ``remarks`` into the summary; they stay staff's."""
    summary = {
        "total_items": 1,
        "received_at": "2026-10-28T02:12:00.000Z",
        "remarks": "ลังบุบ SECRET",
        "closed_by": "สมศรี",
        "closed_reason": "all_points",
        "items": [{"item_id": "item:rice", "qty": "5", "unit": "ถุง"}],
    }
    _, payload = project_donation(
        _donation(status="received", received_summary=summary), shelter_code="SH001"
    )

    assert payload is not None
    assert "remarks" not in payload["received_summary"]
    assert payload["received_summary"]["closed_reason"] == "all_points"
    assert "SECRET" not in repr(payload)
    assert summary["remarks"] == "ลังบุบ SECRET"
