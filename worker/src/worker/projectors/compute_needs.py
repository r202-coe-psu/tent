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
counting it in both places would close the need at half the goods.
"""

from __future__ import annotations

from typing import Any

#: A donation stops owing the shelter anything once it is expired or cancelled. The
#: wider set is kept deliberately — narrowing it here would change what the public board
#: counts, which is a separate decision from wiring the warehouse in.
# Settled: the goods are never arriving at this shelter, so they cannot cover a
# need. "redirected" joins the set with CR-087 (handed to another shelter);
# "rejected" belongs here for the same reason and had been missed.
_SETTLED_STATUSES = frozenset({"expired", "cancelled", "redirected", "rejected"})


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _keyed_donation_ids(stock_ledgers: list[dict[str, Any]]) -> set[str]:
    """Donations already booked into the ledger, so their goods count as on-hand."""
    return {
        str(entry["ref_id"])
        for entry in stock_ledgers
        if entry.get("reason") == "donation" and entry.get("ref_id")
    }


def on_hand_by_item(stock_ledgers: list[dict[str, Any]]) -> dict[str, float]:
    balance: dict[str, float] = {}
    for entry in stock_ledgers:
        item_id = entry.get("item_id")
        if not item_id:
            continue
        balance[item_id] = balance.get(item_id, 0.0) + _to_float(entry.get("qty"))
    return balance


def _reserved_by_item(
    donations: list[dict[str, Any]],
    stock_ledgers: list[dict[str, Any]],
    campaign_id: str,
) -> dict[str, float]:
    keyed = _keyed_donation_ids(stock_ledgers)
    reserved: dict[str, float] = {}
    for donation in donations:
        if donation.get("campaign_id") != campaign_id:
            continue
        status = donation.get("status")
        if status in _SETTLED_STATUSES:
            continue
        # Received *and* already booked into the ledger: the goods are on the shelf,
        # counted in on_hand. Counting them again here closes the need at half.
        if status == "received" and str(donation.get("_id")) in keyed:
            continue
        for item in donation.get("items") or []:
            item_id = item.get("item_id")
            if not item_id:
                continue
            reserved[item_id] = reserved.get(item_id, 0.0) + _to_float(item.get("qty"))
    return reserved


def compute_needs(
    campaigns: list[dict[str, Any]],
    donations: list[dict[str, Any]],
    stock_ledgers: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """Remaining need per item, summed over campaigns, and the item → campaign map.

    ``stock_ledgers`` defaults to empty so existing callers keep working, but the
    public projector must pass it — without the warehouse the answer is wrong in
    exactly the direction that over-collects.
    """
    ledgers = stock_ledgers or []
    on_hand = on_hand_by_item(ledgers)

    remaining: dict[str, float] = {}
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
            covered = on_hand.get(item_id, 0.0) + reserved.get(item_id, 0.0)
            rem = 0.0 if is_closed else _to_float(need.get("qty_target")) - covered
            remaining[item_id] = remaining.get(item_id, 0.0) + rem
            # Bind the item to a campaign still accepting it.
            if not is_closed and item_id not in item_campaign:
                item_campaign[item_id] = campaign_id

    return (
        {item_id: str(qty) for item_id, qty in remaining.items()},
        item_campaign,
    )
