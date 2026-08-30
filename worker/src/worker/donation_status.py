"""Donation lifecycle statuses shared by the quota and retention jobs.

``schema.md`` §2.3 is the source of truth: ``declared`` → ``pending_review`` →
``verifying`` → ``received``, with ``redirected`` / ``rejected`` / ``expired`` /
``cancelled`` as the terminal branches.

The set below exists because CR-052 moved where a public booking *starts*. Before it,
every booking opened at ``declared`` and each job could ask ``status == "declared"``
directly. Now a booking opens at ``pending_review`` and walks through ``verifying``, so
that literal silently stopped matching the bookings it was written for — expiry stopped
firing, reconcile stopped seeing held quota. Keeping one named set means the next status
added to the review chain is a one-line change here rather than a hunt through the jobs.
"""

from __future__ import annotations

#: Statuses where the goods have not reached the shelf yet but the booking still holds
#: its share of a campaign's target. Mirrors ``DONATION_OUTSTANDING_STATUSES`` in
#: ``frontend/src/lib/features/operations/domain/operations.ts`` — the two describe the
#: same rule on either side of the sync and have to move together.
DONATION_OUTSTANDING_STATUSES = frozenset({"declared", "pending_review", "verifying"})


def is_donation_outstanding(status: object) -> bool:
    """True when the booking is still owed to us — promised, not yet on the shelf."""
    return status in DONATION_OUTSTANDING_STATUSES
