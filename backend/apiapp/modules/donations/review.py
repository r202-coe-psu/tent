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

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

ReviewStatus = Literal["approved", "pending", "rejected"]

#: The three per-line fields CR-174 FR-1 adds to ``donation.items[]``.
REVIEW_FIELDS = ("review_status", "review_reason_code", "review_reason")

#: The fields of ``DonationItemInput`` — everything the donor can change on a line. A line
#: equal to an old one on all of these was not edited (FR-18a). The edit form sends back
#: only item_id/free_text/qty/unit; ``update_items`` re-attaches the rest from the held
#: line first (``_carry_line_details``), or no line would ever match.
MATCH_FIELDS = ("item_id", "category", "free_text", "qty", "unit", "condition", "note")

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
    #: A line that kept an approval it already had is not counted.
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


def _with_review(
    item: Mapping[str, Any],
    review_status: str,
    reason_code: Any = None,
    reason: Any = None,
) -> dict[str, Any]:
    row = {key: value for key, value in item.items() if key not in REVIEW_FIELDS}
    row["review_status"] = review_status
    # The two reason fields are written only on a rejection (FR-1).
    if review_status == "rejected":
        if reason_code is not None:
            row["review_reason_code"] = reason_code
        if reason is not None:
            row["review_reason"] = reason
    return row


def _without_review(item: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key not in REVIEW_FIELDS}


def _auto_review(item: Mapping[str, Any], reserved: bool) -> dict[str, Any]:
    """FR-2: a line holding a reservation in the campaign is approved; any other waits."""
    return _with_review(item, "approved" if reserved else "pending")


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


def _normalised(value: Any, *, numeric: bool) -> Any:
    # The edit form trims what it sends back; the donate wizard does not. Unstripped, a name
    # typed with a trailing space read as edited on the first edit and lost its review.
    if isinstance(value, str):
        value = value.strip()
    # FR-18a: an empty value and a missing field are the same thing.
    if value is None or value == "":
        return None
    if numeric:
        try:
            # normalize() so 5, "5", "5.0" and 5.00 all compare equal.
            return Decimal(str(value)).normalize()
        except InvalidOperation, TypeError, ValueError:
            return str(value)
    return value


def line_key(item: Mapping[str, Any]) -> tuple[Any, ...]:
    """What makes two lines "the same line" for FR-18a."""
    return tuple(_normalised(item.get(name), numeric=name == "qty") for name in MATCH_FIELDS)


def _has_review(items: Sequence[Mapping[str, Any]]) -> bool:
    return any(item.get("review_status") for item in items)


def review_edited_booking(
    *,
    previous_items: Sequence[Mapping[str, Any]],
    previous_status: str,
    items: Sequence[Mapping[str, Any]],
    reserved: Sequence[bool],
    hold_for_review: Collection[int] = (),
) -> ReviewOutcome:
    """FR-18 / FR-18a / FR-18c — re-review a basket the donor just edited.

    ``previous_items``/``previous_status`` are the booking as it stood before the edit
    (from CouchDB when the BFF sent it, else the Mongo copies). ``items`` is the new
    basket and ``reserved[i]`` whether line ``i`` holds quota after this edit.

    A new line equal to an unused old line on every ``MATCH_FIELDS`` field keeps that old
    line's result, rejected included; each old line can be claimed once, so two identical
    new lines do not both inherit one approval. Every other line is judged by FR-2, except
    the indexes in ``hold_for_review``: lines that could not be told apart from an old one,
    which wait for staff whatever they hold.
    """
    if len(items) != len(reserved):
        raise ValueError("reserved must have one flag per line")

    legacy = not _has_review(previous_items)

    if legacy and previous_status == "declared":
        # FR-18c: a booking still at `declared` was never put to review. Leave it there.
        return ReviewOutcome(items=[_without_review(item) for item in items], status="declared")

    if legacy and previous_status == "verifying":
        # FR-18c: staff approved the whole booking, which is every line.
        previous = [_with_review(item, "approved") for item in previous_items]
    elif legacy:
        # FR-18c: `pending_review` (or anything else) from before schema_v 7 — nothing was
        # judged per line yet, so every line is judged now, exactly like a new booking.
        previous = []
    else:
        previous = [dict(item) for item in previous_items]

    unclaimed: dict[tuple[Any, ...], list[Mapping[str, Any]]] = {}
    for item in previous:
        unclaimed.setdefault(line_key(item), []).append(item)

    rows: list[dict[str, Any]] = []
    auto_approved: list[int] = []
    for index, (item, held) in enumerate(zip(items, reserved, strict=True)):
        candidates = unclaimed.get(line_key(item))
        if candidates:
            match = candidates.pop(0)
            if match.get("review_status"):
                rows.append(
                    _with_review(
                        item,
                        str(match["review_status"]),
                        match.get("review_reason_code"),
                        match.get("review_reason"),
                    )
                )
                continue
        row = _auto_review(item, held and index not in hold_for_review)
        if row["review_status"] == "approved":
            auto_approved.append(index)
        rows.append(row)

    return ReviewOutcome(items=rows, status=booking_status(rows), auto_approved_lines=auto_approved)
