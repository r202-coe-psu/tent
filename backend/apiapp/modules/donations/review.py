"""Per-line review of a public donation (CR-174).

Staff review moved from the whole booking to each line. A line FastAPI managed to reserve
quota for inside the booking's campaign is approved on the spot; anything else — typed by
the donor, booked without a campaign, or against a counter that was not seeded yet — waits
for a person (FR-2). The booking's own status is then read off its lines (FR-4..FR-6).

Everything here is pure: callers hand in the lines and which of them hold a reservation,
and get the lines back with their review fields set. The I/O — counters, buffer, stub —
stays in ``use_case.py``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

ReviewStatus = Literal["approved", "pending", "rejected"]
ItemEditGate = Literal["editable", "already_reviewed", "closed"]

#: The three per-line fields CR-174 FR-1 adds to ``donation.items[]``.
REVIEW_FIELDS = ("review_status", "review_reason_code", "review_reason")

#: Status a booking takes when it has no lines at all. Nothing to approve, so it waits for
#: a person exactly as every booking did before CR-174.
EMPTY_BOOKING_STATUS = "pending_review"


@dataclass(frozen=True)
class ReviewOutcome:
    #: The lines as they should be stored, with the review fields set (or left off, for a
    #: ``declared`` booking from before schema_v 7 — FR-18c).
    items: list[dict[str, Any]]
    #: The booking status read off those lines.
    status: str
    #: Index into ``items`` of every line approved automatically by this call (FR-26).
    auto_approved_lines: list[int] = field(default_factory=list)


def booking_status(items: Sequence[Mapping[str, Any]]) -> str:
    """FR-4..FR-6 — the booking status its lines add up to.

    Any line still waiting keeps the whole booking in review; otherwise one approved line
    is enough for the QR; only a booking every line of which was turned down is rejected.
    """
    statuses = [item.get("review_status") for item in items]
    if not statuses:
        return EMPTY_BOOKING_STATUS
    if "pending" in statuses:
        return "pending_review"
    if "approved" in statuses:
        return "verifying"
    if all(value == "rejected" for value in statuses):
        return "rejected"
    # Only lines without a review status (pre-schema_v 7) are left, or those plus refusals:
    # nothing here can be judged, so the booking waits for a person rather than being
    # refused by accident. A mix with an approved line already returned `verifying` above
    # — the frontend's ``donationStatusFromLines`` answers the same.
    return "pending_review"


def _without_review(item: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key not in REVIEW_FIELDS}


def _auto_review(item: Mapping[str, Any], reserved: bool) -> dict[str, Any]:
    """FR-2: a line holding a reservation in the campaign is approved; any other waits."""
    row = _without_review(item)
    row["review_status"] = "approved" if reserved else "pending"
    return row


def review_new_booking(
    items: Sequence[Mapping[str, Any]], reserved: Sequence[bool]
) -> ReviewOutcome:
    """FR-2 + FR-4..FR-7 at creation. ``reserved[i]`` says whether line ``i`` got quota."""
    if len(items) != len(reserved):
        raise ValueError("reserved must have one flag per line")
    rows = [_auto_review(item, held) for item, held in zip(items, reserved, strict=True)]
    return ReviewOutcome(
        items=rows,
        status=booking_status(rows),
        auto_approved_lines=[i for i, row in enumerate(rows) if row["review_status"] == "approved"],
    )


#: CR-196 FR-LK-4 — what a donor's item edit meets, by booking status. ``verifying`` (the QR
#: is out) and ``rejected`` already carry a review's outcome; received, cancelled, expired
#: and redirected bookings are no longer the donor's at all.
_ITEM_EDIT_BY_STATUS: Mapping[str, ItemEditGate] = {
    "declared": "editable",
    "pending_review": "editable",
    "verifying": "already_reviewed",
    "rejected": "already_reviewed",
}

#: A line the campaign rule or a person has decided. ``pending`` is still waiting.
_DECIDED = frozenset({"approved", "rejected"})


def item_edit_gate(status: str, items: Sequence[Mapping[str, Any]]) -> ItemEditGate:
    """CR-196 FR-LK-4 — whether the donor may still change this booking's lines.

    Once anything was decided — a campaign line approved automatically, or staff deciding
    a line — the lines are fixed: an edit could otherwise re-pair a refused line with an
    approved one and come out approved (review #783 H1). The donor cancels and books
    again, or tells staff at drop-off. Mirrors ``donationItemEditGate`` on the BFF.
    """
    gate = _ITEM_EDIT_BY_STATUS.get(status, "closed")
    if gate == "editable" and any(item.get("review_status") in _DECIDED for item in items):
        return "already_reviewed"
    return gate


def review_edited_booking(
    *,
    previous_status: str,
    items: Sequence[Mapping[str, Any]],
    reserved: Sequence[bool],
) -> ReviewOutcome:
    """FR-18 — review a basket the donor just edited. ``reserved[i]``: line ``i`` holds quota.

    ``item_edit_gate`` lets only a booking nothing was decided on reach an edit, so there
    is no earlier result to keep: every line is judged by FR-2 like a new booking. A
    ``declared`` booking (from before schema_v 7) was never put to review and stays there
    without review fields (FR-18c).
    """
    if previous_status == "declared":
        if len(items) != len(reserved):
            raise ValueError("reserved must have one flag per line")
        return ReviewOutcome(items=[_without_review(item) for item in items], status="declared")
    return review_new_booking(items, reserved)
