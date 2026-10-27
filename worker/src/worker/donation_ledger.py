"""What part of a donation is still owed once the stock ledger is taken into account.

One reading of the ledger for both places that need it: the public needs projector
(``worker.projectors.compute_needs``) and the quota reconciliation
(``worker.quota.reconcile``). They used to read it separately and disagreed — the
reconciliation left shelved goods in ``reserved_qty`` while ``on_hand_qty`` held them
too, so the booking ceiling dropped twice and a need the board showed 89 open for
refused a booking of 89.

Mirrors ``keyedDonationIds`` / ``recordedDonationQty`` and the loop in
``computeNeeds`` (``frontend/src/lib/features/donations/domain/compute-needs.ts``):

* a ``received`` donation with any ledger row is done — its goods are in on-hand;
* any other donation still owes each line minus what is already recorded for it
  (CR-143 FR-B7/B9: a batch receipt interrupted half way).
"""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal, InvalidOperation
from typing import Any

RecordedQty = dict[str, dict[str, Decimal]]


def _to_decimal(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value))
    except InvalidOperation, TypeError, ValueError:
        return None


def normalize_donation_id(raw: str) -> str:
    """Intake buffers may carry the bare ULID; CouchDB and the ledger carry the prefix."""
    return raw if raw.startswith("donation:") else f"donation:{raw}"


def keyed_donation_ids(stock_ledgers: list[dict[str, Any]]) -> set[str]:
    """Donations with at least one ``reason: donation`` row in the ledger."""
    return {
        normalize_donation_id(str(entry["ref_id"]))
        for entry in stock_ledgers
        if entry.get("reason") == "donation" and entry.get("ref_id")
    }


def recorded_donation_qty(stock_ledgers: list[dict[str, Any]]) -> RecordedQty:
    """Qty already in the ledger, per donation id per item — positive rows only."""
    recorded: RecordedQty = {}
    for entry in stock_ledgers:
        ref_id = entry.get("ref_id")
        item_id = entry.get("item_id")
        if entry.get("reason") != "donation" or not ref_id or not item_id:
            continue
        qty = _to_decimal(entry.get("qty"))
        if qty is None or qty <= 0:
            continue
        per_item = recorded.setdefault(normalize_donation_id(str(ref_id)), {})
        per_item[str(item_id)] = per_item.get(str(item_id), Decimal(0)) + qty
    return recorded


def still_owed(
    donation: dict[str, Any], keyed: set[str], recorded: RecordedQty
) -> Iterator[tuple[str | None, Decimal]]:
    """Each line of ``donation`` with the qty not on the shelf yet.

    Status filtering stays with the caller — the projector and the reconciliation
    each have their own set. Lines with an unusable or fully recorded qty are dropped;
    lines without ``item_id`` are kept so the caller can report them.
    """
    donation_id = normalize_donation_id(str(donation.get("_id", "")))
    if donation.get("status") == "received" and donation_id in keyed:
        return
    already = recorded.get(donation_id, {})
    for item in donation.get("items") or []:
        item_id = item.get("item_id")
        qty = _to_decimal(item.get("qty"))
        if qty is None:
            continue
        if item_id:
            qty -= already.get(str(item_id), Decimal(0))
        if qty <= 0:
            continue
        yield item_id, qty
