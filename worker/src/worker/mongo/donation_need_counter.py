"""Write donation_need_counter seeds to MongoDB (CR-060)."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, datetime

from tent_model import seed_counter

from worker.projectors.donation_need_counter import NeedCounterSeed

logger = logging.getLogger(__name__)


async def apply_need_counters(seeds: Iterable[NeedCounterSeed]) -> int:
    """Seed each planned counter; returns how many were newly created.

    Not routed through ``worker.mongo.upsert.apply_document`` on purpose — that helper
    rewrites the whole document and would clobber ``reserved_qty``, which FastAPI owns
    (CR-060 FR-3). ``seed_counter`` touches only the worker's own fields.
    """
    now = datetime.now(UTC)
    created = 0
    for seed in seeds:
        if await seed_counter(
            shelter_code=seed.shelter_code,
            campaign_id=seed.campaign_id,
            item_id=seed.item_id,
            qty_target=seed.qty_target,
            now=now,
        ):
            created += 1
    if created:
        logger.info("seeded %d donation_need_counter doc(s)", created)
    return created
