"""ListenerManager warns before the feed pool runs out."""

from __future__ import annotations

import asyncio
import logging
from unittest.mock import MagicMock, patch

import pytest

from worker.listeners.registry import ListenerManager


async def _idle(*_args, **_kwargs) -> None:
    await asyncio.sleep(3600)


@pytest.mark.asyncio
async def test_warns_when_listeners_pass_80_percent_of_the_feed_cap(caplog):
    couch = MagicMock()
    couch.feed_max_connections = 10
    manager = ListenerManager(couch)

    with (
        patch("worker.listeners.registry.tail_database", _idle),
        caplog.at_level(logging.WARNING, logger="worker.listeners.registry"),
    ):
        for i in range(8):
            await manager.ensure_listener(f"shelter_sh{i:03d}")
        assert not caplog.records  # 8 of 10 is exactly 80% — no warning yet
        await manager.ensure_listener("shelter_sh008")

    assert any(
        "COUCH_FEED_MAX_CONNECTIONS=10" in r.getMessage() for r in caplog.records
    )
    for task in manager._tasks.values():
        task.cancel()
