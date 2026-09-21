"""When a quota ceiling may follow its campaign — shared by the CDC path and the CLI.

``donation_need_counter.qty_target`` is the ceiling FastAPI reserves against. Two
places move it onto the campaign's current figure: the CDC projector (every campaign
edit) and ``donation-quota recalculate --targets`` (operator-run repair). They have to
agree on when that is allowed, so the decision lives here rather than in either one.

The rule is one line — never lower a ceiling below the quota donors already hold — but
it is the whole reason the ceiling cannot simply track the campaign: those bookings
were accepted under the old ceiling and are still owed. Lowering under them makes
``reserved_qty + qty <= qty_target`` false for reservations that already exist, so the
need reads as over-full and can never be released cleanly.

Pure and I/O-free on purpose: both callers own their own reads, writes and reporting.

Flat module rather than ``worker.quota.*`` (like ``worker.donation_status``): importing
anything under ``worker.quota`` runs its ``__init__``, which pulls ``worker.couch`` and
back into ``worker.mongo`` — a cycle for the Mongo writer that needs this rule.
"""

from __future__ import annotations

from decimal import Decimal
from enum import Enum


class TargetDecision(Enum):
    """What to do with one counter whose campaign target may have moved."""

    #: Ceiling already matches the campaign — no write.
    UNCHANGED = "unchanged"
    #: Safe to move the ceiling onto the campaign's figure.
    APPLY = "apply"
    #: Would drop the ceiling under quota already reserved — caller reports, never writes.
    REFUSED_BELOW_RESERVED = "refused_below_reserved"


def decide_target_change(
    *, stored: Decimal, wanted: Decimal, reserved: Decimal
) -> TargetDecision:
    """Whether the ceiling may move from ``stored`` to ``wanted``.

    ``reserved`` is what donors currently hold against this need. Callers that can
    recompute it should pass the LARGER of the stored and the recomputed figure: the
    stored one alone can be stale, and trusting it would lower a ceiling under quota
    that is about to be recorded as held.

    Raising a ceiling is always allowed — it can only make room. ``wanted == reserved``
    is allowed too: the need goes exactly full rather than over-full, which is a state
    the cut-off rule already handles.
    """
    if stored == wanted:
        return TargetDecision.UNCHANGED
    if wanted < reserved:
        return TargetDecision.REFUSED_BELOW_RESERVED
    return TargetDecision.APPLY
