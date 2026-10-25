"""Per-line review of a public donation (CR-174) — the pure rules, no Mongo."""

from __future__ import annotations

import pytest

from apiapp.modules.donations.review import (
    booking_status,
    line_key,
    review_edited_booking,
    review_new_booking,
)

RICE = {"item_id": "item:rice", "free_text": "ข้าวสาร", "qty": "5", "unit": "kg"}
WATER = {"item_id": "item:water", "free_text": "น้ำดื่ม", "qty": "12", "unit": "ขวด"}
DIAPERS = {"free_text": "ผ้าอ้อมผู้ใหญ่", "qty": "3", "unit": "แพ็ค"}
BLANKET = {"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน", "note": "มือสอง"}


def _statuses(items: list[dict]) -> list[str | None]:
    return [item.get("review_status") for item in items]


# --- FR-4..FR-6: the booking status is read off its lines ---


@pytest.mark.parametrize(
    ("lines", "expected"),
    [
        (["approved", "approved"], "verifying"),
        (["approved", "pending"], "pending_review"),
        (["pending"], "pending_review"),
        (["rejected", "pending"], "pending_review"),
        (["approved", "rejected"], "verifying"),
        (["rejected", "rejected"], "rejected"),
        (["rejected"], "rejected"),
    ],
)
def test_booking_status_follows_its_lines(lines: list[str], expected: str) -> None:
    assert booking_status([{"review_status": value} for value in lines]) == expected


def test_a_line_without_a_review_never_waves_the_booking_through() -> None:
    assert booking_status([{"review_status": "rejected"}, {}]) == "pending_review"


def test_an_empty_booking_waits_for_review() -> None:
    assert booking_status([]) == "pending_review"


# --- FR-2 / FR-7 at creation ---


def test_ac1_every_line_in_the_campaign_opens_verifying() -> None:
    outcome = review_new_booking([RICE, WATER], [True, True])

    assert outcome.status == "verifying"
    assert _statuses(outcome.items) == ["approved", "approved"]
    assert outcome.auto_approved_lines == [0, 1]


def test_ac2_a_mixed_booking_waits_only_for_the_typed_line() -> None:
    outcome = review_new_booking([RICE, DIAPERS], [True, False])

    assert outcome.status == "pending_review"
    assert _statuses(outcome.items) == ["approved", "pending"]
    assert outcome.auto_approved_lines == [0]


def test_ac4_only_typed_lines_opens_pending_review() -> None:
    outcome = review_new_booking([DIAPERS, BLANKET], [False, False])

    assert outcome.status == "pending_review"
    assert _statuses(outcome.items) == ["pending", "pending"]
    assert outcome.auto_approved_lines == []


def test_a_campaign_line_the_counter_did_not_reserve_waits() -> None:
    """NOT_SEEDED / no campaign — the line carries an item_id but holds no quota."""
    outcome = review_new_booking([RICE], [False])

    assert outcome.status == "pending_review"
    assert _statuses(outcome.items) == ["pending"]


def test_no_reason_is_written_on_an_approved_or_pending_line() -> None:
    outcome = review_new_booking(
        [{**RICE, "review_reason": "x", "review_reason_code": "other"}, DIAPERS], [True, False]
    )
    for row in outcome.items:
        assert "review_reason" not in row
        assert "review_reason_code" not in row


def test_the_client_cannot_choose_its_own_review() -> None:
    """FR-3 — a review_status smuggled in on the line is overwritten."""
    outcome = review_new_booking([{**DIAPERS, "review_status": "approved"}], [False])

    assert _statuses(outcome.items) == ["pending"]


def test_other_fields_ride_through_untouched() -> None:
    outcome = review_new_booking([{**RICE, "reserved_qty": "5"}], [True])

    assert outcome.items[0]["reserved_qty"] == "5"
    assert outcome.items[0]["free_text"] == "ข้าวสาร"


# --- FR-18a: what counts as an untouched line ---


def test_empty_and_missing_are_the_same() -> None:
    assert line_key({**DIAPERS, "note": ""}) == line_key(DIAPERS)
    assert line_key({**DIAPERS, "note": None}) == line_key(DIAPERS)
    assert line_key({**DIAPERS, "note": "  "}) == line_key(DIAPERS)


def test_surrounding_spaces_are_not_an_edit() -> None:
    """The wizard keeps a trailing space a phone keyboard added; the edit form trims it."""
    assert line_key({**DIAPERS, "free_text": "ผ้าอ้อมผู้ใหญ่ "}) == line_key(DIAPERS)


@pytest.mark.parametrize("qty", [3, "3", "3.0", 3.0, "3.00"])
def test_qty_compares_as_a_number(qty: object) -> None:
    assert line_key({**DIAPERS, "qty": qty}) == line_key(DIAPERS)


@pytest.mark.parametrize(
    "change",
    [
        {"note": "ใหม่"},
        {"condition": "used"},
        {"category": "hygiene"},
        {"unit": "ห่อ"},
        {"qty": "4"},
        {"free_text": "ผ้าอ้อมเด็ก"},
        {"item_id": "item:diapers"},
    ],
)
def test_any_one_field_changed_is_an_edit(change: dict) -> None:
    assert line_key({**DIAPERS, **change}) != line_key(DIAPERS)


def test_bookkeeping_fields_do_not_count() -> None:
    assert line_key({**RICE, "reserved_qty": "5", "review_status": "approved"}) == line_key(RICE)


# --- FR-18 on a schema_v 7 booking ---


def _reviewed(item: dict, status: str, **reason: str) -> dict:
    return {**item, "review_status": status, **reason}


def test_ac7_adding_a_typed_line_to_a_verifying_booking_sends_it_back() -> None:
    outcome = review_edited_booking(
        previous_items=[_reviewed(RICE, "approved")],
        previous_status="verifying",
        items=[RICE, DIAPERS],
        reserved=[True, False],
    )

    assert outcome.status == "pending_review"
    assert _statuses(outcome.items) == ["approved", "pending"]
    # The rice line kept the approval it had — no new auto approval to audit.
    assert outcome.auto_approved_lines == []


def test_ac10_editing_a_staff_approved_typed_line_puts_it_back_in_review() -> None:
    outcome = review_edited_booking(
        previous_items=[_reviewed(RICE, "approved"), _reviewed(DIAPERS, "approved")],
        previous_status="verifying",
        items=[RICE, {**DIAPERS, "qty": "6"}],
        reserved=[True, False],
    )

    assert outcome.status == "pending_review"
    assert _statuses(outcome.items) == ["approved", "pending"]


def test_ac16_changing_only_the_note_is_an_edit() -> None:
    outcome = review_edited_booking(
        previous_items=[_reviewed(RICE, "approved"), _reviewed(BLANKET, "approved")],
        previous_status="verifying",
        items=[RICE, {**BLANKET, "note": "ใหม่ ยังไม่แกะ"}],
        reserved=[True, False],
    )

    assert _statuses(outcome.items) == ["approved", "pending"]
    assert outcome.status == "pending_review"


def test_an_untouched_rejected_line_stays_rejected_with_its_reason() -> None:
    previous = [
        _reviewed(RICE, "approved"),
        _reviewed(BLANKET, "rejected", review_reason_code="damaged", review_reason="ขาดหลายจุด"),
    ]
    outcome = review_edited_booking(
        previous_items=previous,
        previous_status="verifying",
        items=[{**RICE, "qty": "6"}, BLANKET],
        reserved=[True, False],
    )

    assert outcome.items[1]["review_status"] == "rejected"
    assert outcome.items[1]["review_reason_code"] == "damaged"
    assert outcome.items[1]["review_reason"] == "ขาดหลายจุด"
    assert outcome.items[0]["review_status"] == "approved"
    # The rice line changed and is approved again by the campaign rule — audit it.
    assert outcome.auto_approved_lines == [0]
    assert outcome.status == "verifying"


def test_lines_are_matched_regardless_of_order() -> None:
    outcome = review_edited_booking(
        previous_items=[_reviewed(DIAPERS, "approved"), _reviewed(RICE, "approved")],
        previous_status="verifying",
        items=[RICE, DIAPERS],
        reserved=[True, False],
    )

    assert _statuses(outcome.items) == ["approved", "approved"]
    assert outcome.status == "verifying"


def test_an_old_line_can_be_claimed_once() -> None:
    """Duplicating a staff-approved typed line does not approve the copy too."""
    outcome = review_edited_booking(
        previous_items=[_reviewed(DIAPERS, "approved")],
        previous_status="verifying",
        items=[DIAPERS, DIAPERS],
        reserved=[False, False],
    )

    assert _statuses(outcome.items) == ["approved", "pending"]
    assert outcome.status == "pending_review"


def test_ac22_dropping_the_typed_line_leaves_a_verifying_booking() -> None:
    outcome = review_edited_booking(
        previous_items=[_reviewed(RICE, "approved"), _reviewed(DIAPERS, "pending")],
        previous_status="pending_review",
        items=[RICE],
        reserved=[True],
    )

    assert outcome.status == "verifying"
    assert _statuses(outcome.items) == ["approved"]
    # Approved at creation and audited then — not again.
    assert outcome.auto_approved_lines == []


def test_an_untouched_pending_line_keeps_waiting() -> None:
    outcome = review_edited_booking(
        previous_items=[_reviewed(RICE, "approved"), _reviewed(DIAPERS, "pending")],
        previous_status="pending_review",
        items=[{**RICE, "qty": "7"}, DIAPERS],
        reserved=[True, False],
    )

    assert _statuses(outcome.items) == ["approved", "pending"]
    assert outcome.auto_approved_lines == [0]


def test_keeping_only_rejected_lines_rejects_the_booking() -> None:
    outcome = review_edited_booking(
        previous_items=[
            _reviewed(DIAPERS, "rejected", review_reason_code="not_needed"),
            _reviewed(BLANKET, "pending"),
        ],
        previous_status="pending_review",
        items=[DIAPERS],
        reserved=[False],
    )

    assert outcome.status == "rejected"


def test_an_edited_campaign_line_the_counter_did_not_reserve_waits() -> None:
    outcome = review_edited_booking(
        previous_items=[_reviewed(RICE, "approved")],
        previous_status="verifying",
        items=[{**RICE, "qty": "9"}],
        reserved=[False],
    )

    assert _statuses(outcome.items) == ["pending"]
    assert outcome.status == "pending_review"


# --- FR-18c: bookings from before schema_v 7 ---


def test_ac19_legacy_verifying_keeps_the_typed_line_approved() -> None:
    outcome = review_edited_booking(
        previous_items=[RICE, DIAPERS],
        previous_status="verifying",
        items=[{**RICE, "qty": "8"}, DIAPERS],
        reserved=[True, False],
    )

    assert _statuses(outcome.items) == ["approved", "approved"]
    assert outcome.status == "verifying"
    # The rice line changed and was approved by the rule now — that one is audited.
    assert outcome.auto_approved_lines == [0]


def test_legacy_verifying_still_reviews_a_new_typed_line() -> None:
    outcome = review_edited_booking(
        previous_items=[RICE],
        previous_status="verifying",
        items=[RICE, BLANKET],
        reserved=[True, False],
    )

    assert _statuses(outcome.items) == ["approved", "pending"]
    assert outcome.status == "pending_review"
    assert outcome.auto_approved_lines == []


def test_ac20_legacy_pending_review_is_judged_like_a_new_booking() -> None:
    outcome = review_edited_booking(
        previous_items=[RICE, WATER, DIAPERS],
        previous_status="pending_review",
        items=[RICE, {**WATER, "qty": "24"}, DIAPERS],
        reserved=[True, True, False],
    )

    assert _statuses(outcome.items) == ["approved", "approved", "pending"]
    assert outcome.status == "pending_review"
    assert outcome.auto_approved_lines == [0, 1]


def test_ac22_legacy_pending_review_dropping_the_typed_line_audits_every_line() -> None:
    outcome = review_edited_booking(
        previous_items=[RICE, WATER, DIAPERS],
        previous_status="pending_review",
        items=[RICE, WATER],
        reserved=[True, True],
    )

    assert outcome.status == "verifying"
    assert outcome.auto_approved_lines == [0, 1]


def test_ac21_a_declared_booking_stays_declared_with_no_review() -> None:
    outcome = review_edited_booking(
        previous_items=[RICE],
        previous_status="declared",
        items=[{**RICE, "qty": "9", "review_status": "approved"}, DIAPERS],
        reserved=[True, False],
    )

    assert outcome.status == "declared"
    assert _statuses(outcome.items) == [None, None]
    assert outcome.auto_approved_lines == []


def test_the_flags_must_line_up_with_the_lines() -> None:
    with pytest.raises(ValueError):
        review_new_booking([RICE], [])
    with pytest.raises(ValueError):
        review_edited_booking(
            previous_items=[], previous_status="verifying", items=[RICE], reserved=[]
        )
