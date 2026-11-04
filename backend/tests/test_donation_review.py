"""Per-line review of a public donation (CR-174) — the pure rules, no Mongo."""

from __future__ import annotations

import pytest

from apiapp.modules.donations.review import (
    booking_status,
    item_edit_gate,
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


# --- CR-196 FR-LK-4: an edit is open only while nothing was decided ---


@pytest.mark.parametrize("status", ["declared", "pending_review"])
def test_a_booking_nothing_was_decided_on_is_editable(status: str) -> None:
    assert item_edit_gate(status, [{**DIAPERS, "review_status": "pending"}, BLANKET]) == "editable"


@pytest.mark.parametrize("decided", ["approved", "rejected"])
def test_one_decided_line_closes_the_edit(decided: str) -> None:
    """An approval by the campaign rule counts as much as a person's decision."""
    lines = [{**RICE, "review_status": decided}, {**DIAPERS, "review_status": "pending"}]

    assert item_edit_gate("pending_review", lines) == "already_reviewed"


@pytest.mark.parametrize("status", ["verifying", "rejected"])
def test_a_reviewed_booking_is_already_reviewed(status: str) -> None:
    """Even a booking from before schema_v 7, whose lines carry no review of their own."""
    assert item_edit_gate(status, [RICE]) == "already_reviewed"


@pytest.mark.parametrize("status", ["received", "cancelled", "expired", "redirected", "?"])
def test_a_booking_past_drop_off_is_closed(status: str) -> None:
    assert item_edit_gate(status, [RICE]) == "closed"


# --- FR-18: an edited booking is judged afresh ---


def test_every_line_of_an_edit_is_judged_by_the_campaign_rule() -> None:
    outcome = review_edited_booking(
        previous_status="pending_review",
        items=[{**RICE, "review_status": "pending"}, DIAPERS],
        reserved=[True, False],
    )

    assert _statuses(outcome.items) == ["approved", "pending"]
    assert outcome.status == "pending_review"
    assert outcome.auto_approved_lines == [0]


def test_an_edit_down_to_campaign_lines_opens_verifying() -> None:
    outcome = review_edited_booking(
        previous_status="pending_review", items=[RICE, WATER], reserved=[True, True]
    )

    assert outcome.status == "verifying"
    assert outcome.auto_approved_lines == [0, 1]


def test_ac21_a_declared_booking_stays_declared_with_no_review() -> None:
    """FR-18c — a booking from before schema_v 7 still at ``declared``."""
    outcome = review_edited_booking(
        previous_status="declared",
        items=[{**RICE, "qty": "9", "review_status": "approved"}, DIAPERS],
        reserved=[True, False],
    )

    assert outcome.status == "declared"
    assert _statuses(outcome.items) == [None, None]
    assert outcome.auto_approved_lines == []


@pytest.mark.parametrize("status", ["declared", "pending_review"])
def test_the_flags_must_line_up_with_the_lines(status: str) -> None:
    with pytest.raises(ValueError):
        review_new_booking([RICE], [])
    with pytest.raises(ValueError):
        review_edited_booking(previous_status=status, items=[RICE], reserved=[])
