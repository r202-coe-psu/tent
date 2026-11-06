"""Keep ``donation_need_counter.on_hand_qty`` in step with the stock ledger.

The reservation ceiling FastAPI reserves against is ``qty_target − on_hand_qty``
(see ``tent_model.donation_need_counter_ops.reserve_quota``). ``qty_target`` is
written once at seed time and never moves, so this is the only thing that keeps the
counter agreeing with the needs board as goods arrive on the shelf.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from tent_model import set_on_hand_qty

from worker.couch.client import CouchClient
from worker.donation_ledger import on_hand_decimals
from worker.masking import shelter_db_name

__all__ = ["refresh_on_hand"]

logger = logging.getLogger(__name__)


async def refresh_on_hand(couch: CouchClient, shelter_code: str) -> int:
    """Push the shelter's current balance onto every counter it has.

    Items with no ledger entry are deliberately left alone rather than zeroed: a
    counter for an item the shelter has never stocked already reads 0, and a blanket
    reset would fight the seed path for no gain.
    """
    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        return 0

    ledgers = [
        doc
        async for doc in couch.iter_all_docs(database)
        if doc.get("type") == "stock_ledger"
        and str(doc.get("_id", "")).startswith("stock_ledger:")
    ]

    now = datetime.now(UTC)
    changed = 0
    for item_id, qty in on_hand_decimals(ledgers).items():
        changed += await set_on_hand_qty(
            shelter_code=shelter_code, item_id=item_id, qty=qty, now=now
        )
    if changed:
        logger.info(
            "refreshed on_hand_qty on %d counter(s) for %s", changed, shelter_code
        )
    return changed
