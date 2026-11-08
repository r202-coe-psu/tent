"""Remaining public need per item — the port of the back-office cut-off formula.

T-22 defines one rule: a need closes when **on-hand + reserved ≥ target**. The
back-office board has computed it that way since CR-034 (`deriveNeedAvailability`
takes the stock ledger). This projector, which feeds the *public* board, used to
subtract only donations and never looked at the warehouse — so a shelter holding
540 kg of rice against a 500 kg target still advertised "ด่วน! ขาด 450 กก." while
its own staff screen showed FULL. Donors were being sent goods the shelter had
already closed intake on.

Two formulas for one rule is what allowed that, so this mirrors the TypeScript one
term for term:

    remaining = target − (on_hand + reserved)

where ``on_hand`` sums the stock ledger (issues are negative rows) and ``reserved``
counts donations still owed to the shelter. A ``received`` donation already written
into the ledger is *excluded* from reserved: its quantity is on the shelf now, and
counting it in both places would close the need at half the goods. An outstanding
donation part-way through a batch receipt owes only its unrecorded part (CR-143).
The ledger reading is shared with the quota counter (``worker.donation_ledger``).

Quantities are ``Decimal`` end to end (#934): ``0.1 + 0.2`` must be ``0.3`` and a need
whose target is met exactly (``on_hand 0.9 + 0.1`` against ``1``) must read 0, not
``1.1e-16``. Rounding to the four stored places is the caller's job (``projectors.needs``).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from worker.donation_ledger import (
    keyed_donation_ids,
    on_hand_decimals,
    recorded_donation_qty,
    still_owed,
)

#: A donation stops owing the shelter anything once it is expired or cancelled. The
#: wider set is kept deliberately — narrowing it here would change what the public board
#: counts, which is a separate decision from wiring the warehouse in.
# Settled: the goods are never arriving at this shelter, so they cannot cover a
# need. "redirected" joins the set with CR-087 (handed to another shelter);
# "rejected" belongs here for the same reason and had been missed.
_SETTLED_STATUSES = frozenset({"expired", "cancelled", "redirected", "rejected"})


def _qty(value: Any) -> Decimal:
    """A need's ``qty_target`` as a finite Decimal; anything unusable counts as 0."""
    try:
        number = Decimal(str(value))
    except InvalidOperation, ValueError:
        return Decimal(0)
    return number if number.is_finite() else Decimal(0)


def _reserved_by_item(
    donations: list[dict[str, Any]],
    stock_ledgers: list[dict[str, Any]],
    campaign_id: str,
) -> dict[str, Decimal]:
    keyed = keyed_donation_ids(stock_ledgers)
    recorded = recorded_donation_qty(stock_ledgers)
    reserved: dict[str, Decimal] = {}
    for donation in donations:
        if donation.get("campaign_id") != campaign_id:
            continue
        if donation.get("status") in _SETTLED_STATUSES:
            continue
        # Received *and* already booked into the ledger: the goods are on the shelf,
        # counted in on_hand — counting them again here closes the need at half. A
        # batch receipt interrupted half way still owes only its unrecorded part.
        for item_id, qty in still_owed(donation, keyed, recorded):
            if not item_id:
                continue
            reserved[item_id] = reserved.get(item_id, Decimal(0)) + qty
    return reserved


def compute_needs(
    campaigns: list[dict[str, Any]],
    donations: list[dict[str, Any]],
    stock_ledgers: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Decimal], dict[str, str]]:
    """Remaining need per item, summed over campaigns, and the item → campaign map.

    ``stock_ledgers`` defaults to empty so existing callers keep working, but the
    public projector must pass it — without the warehouse the answer is wrong in
    exactly the direction that over-collects.
    """
    ledgers = stock_ledgers or []
    on_hand = on_hand_decimals(ledgers)

    remaining: dict[str, Decimal] = {}
    item_campaign: dict[str, str] = {}

    for campaign in campaigns:
        campaign_id = str(campaign.get("_id", ""))
        reserved = _reserved_by_item(donations, ledgers, campaign_id)

        for need in campaign.get("needs") or []:
            item_id = need.get("item_id")
            if not item_id:
                continue
            # A need staff closed by hand takes no more (T-22 manual force cut-off,
            # CR-052). Contributes a zero rather than being skipped: a missing key reads
            # as "not tracked" downstream and lets the booking through.
            is_closed = need.get("status") == "closed"
            covered = on_hand.get(item_id, Decimal(0)) + reserved.get(
                item_id, Decimal(0)
            )
            rem = Decimal(0) if is_closed else _qty(need.get("qty_target")) - covered
            remaining[item_id] = remaining.get(item_id, Decimal(0)) + rem
            # Bind the item to a campaign still accepting it.
            if not is_closed and item_id not in item_campaign:
                item_campaign[item_id] = campaign_id

    return remaining, item_campaign


def need_breakdown(
    campaigns: list[dict[str, Any]],
    donations: list[dict[str, Any]],
    stock_ledgers: list[dict[str, Any]] | None = None,
) -> dict[str, dict[str, Decimal]]:
    """The three terms behind ``remaining``, per item, for the public board to show.

    ``compute_needs`` publishes one number — the shortage — which is all the booking
    guard needs. The donor board also wants to say WHY it is short: how much the shelf
    already holds and how much other donors have promised. Those are the same terms this
    module already computes, so they are returned here rather than re-derived in the UI,
    where they had been faked (``target = qty × 2``, ``reserved = 0``).

    Deliberately a sibling of ``compute_needs`` and not a change to it: the shortage rule
    is pinned across three implementations by ``packages/needs-fixtures``, and widening
    its return type would drag the parity harness along for a display concern.

    Item-level aggregate, matching how the board is keyed (``{shelter}:{item_id}``):
    ``qty_target`` sums every open need asking for the item, ``reserved`` sums what is
    still owed across campaigns, and ``on_hand`` is the shelf balance — counted ONCE per
    item even when several campaigns ask for it, the same simplification ``compute_needs``
    makes when it credits the full balance to each campaign.
    """
    ledgers = stock_ledgers or []
    on_hand = on_hand_decimals(ledgers)

    breakdown: dict[str, dict[str, Decimal]] = {}

    def bucket(item_id: str) -> dict[str, Decimal]:
        return breakdown.setdefault(
            item_id,
            {
                "qty_target": Decimal(0),
                "on_hand": on_hand.get(item_id, Decimal(0)),
                "reserved": Decimal(0),
            },
        )

    for campaign in campaigns:
        campaign_id = str(campaign.get("_id", ""))
        reserved = _reserved_by_item(donations, ledgers, campaign_id)

        for need in campaign.get("needs") or []:
            item_id = need.get("item_id")
            # A need staff closed by hand takes no more, so it announces no target —
            # same treatment `compute_needs` gives it.
            if not item_id or need.get("status") == "closed":
                continue
            entry = bucket(str(item_id))
            entry["qty_target"] += _qty(need.get("qty_target"))
            entry["reserved"] += reserved.get(item_id, Decimal(0))

    return breakdown
