"""Tests for the one-shot bootstrap scan."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from worker.couch.bootstrap import bootstrap_database


def _couch(docs):
    async def iter_all_docs(_database):
        for doc in docs:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs
    couch.db_update_seq = AsyncMock(return_value="42-abc")
    return couch


def _patches():
    return (
        patch("worker.couch.bootstrap.save_checkpoint", new_callable=AsyncMock),
        patch("worker.couch.bootstrap.apply_person", new_callable=AsyncMock),
        patch("worker.couch.bootstrap.apply_donation", new_callable=AsyncMock),
        patch("worker.couch.bootstrap.apply_need", new_callable=AsyncMock),
        patch(
            "worker.couch.bootstrap.project_needs_for_shelter",
            new_callable=AsyncMock,
            return_value=[],
        ),
    )


@pytest.mark.asyncio
async def test_bootstrap_seeds_need_counters_for_existing_campaigns():
    """CR-060 — a provisioned-from-scratch environment must not start with no ceiling.

    Bootstrap saves a checkpoint at the current seq, so campaigns that already existed
    never arrive as CDC events afterwards. If bootstrap skipped them the counters would
    stay empty and reserve_quota would fall open forever.
    """
    couch = _couch(
        [
            {
                "_id": "donation_campaign:c1",
                "type": "donation_campaign",
                "status": "open",
                "needs": [
                    {"item_id": "item:rice", "qty_target": "500"},
                    {"item_id": "item:water", "qty_target": "1000"},
                ],
            }
        ]
    )

    cp, person, donation, need, needs_for = _patches()
    with cp, person, donation, need, needs_for, patch(
        "worker.couch.bootstrap.apply_need_counters", new_callable=AsyncMock
    ) as counters:
        await bootstrap_database(couch, "shelter_sh001")

    seeds = counters.await_args.args[0]
    assert [(s.shelter_code, s.item_id, s.qty_target) for s in seeds] == [
        ("SH001", "item:rice", Decimal("500")),
        ("SH001", "item:water", Decimal("1000")),
    ]


@pytest.mark.asyncio
async def test_bootstrap_does_not_seed_counters_for_a_closed_campaign():
    couch = _couch(
        [
            {
                "_id": "donation_campaign:c1",
                "type": "donation_campaign",
                "status": "closed",
                "needs": [{"item_id": "item:rice", "qty_target": "500"}],
            }
        ]
    )

    cp, person, donation, need, needs_for = _patches()
    with cp, person, donation, need, needs_for, patch(
        "worker.couch.bootstrap.apply_need_counters", new_callable=AsyncMock
    ) as counters:
        await bootstrap_database(couch, "shelter_sh001")

    assert counters.await_args.args[0] == []
