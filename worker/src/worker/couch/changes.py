"""Continuous ``_changes`` feed with reconnect."""

from __future__ import annotations

import asyncio
import logging

from worker.couch.checkpoint import get_last_seq
from worker.couch.client import CouchClient
from worker.couch.processor import process_change

logger = logging.getLogger(__name__)


async def tail_database(
    couch: CouchClient,
    database: str,
    *,
    stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        if not await couch.database_exists(database):
            logger.warning("Database %s not found — retry in 30s", database)
            await asyncio.sleep(30)
            continue
        since = await get_last_seq(database)
        logger.info("Tailing %s since=%s", database, since)
        try:
            async for change in couch.stream_changes(database, since=since):
                if stop_event.is_set():
                    break
                if "last_seq" in change and "results" not in change:
                    continue
                await process_change(database, change)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Changes feed error for %s — retry in 5s", database)
            await asyncio.sleep(5)
