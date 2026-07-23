"""Manage per-database ``_changes`` listener tasks."""

from __future__ import annotations

import asyncio
import logging

from worker.couch.bootstrap import REGISTRY_DB, list_open_shelter_codes
from worker.couch.changes import tail_database
from worker.couch.client import CouchClient
from worker.masking import shelter_db_name

logger = logging.getLogger(__name__)


class ListenerManager:
    def __init__(self, couch: CouchClient) -> None:
        self._couch = couch
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._stop_events: dict[str, asyncio.Event] = {}

    async def sync_open_shelters(self) -> None:
        codes = await list_open_shelter_codes(self._couch)
        desired = {shelter_db_name(code) for code in codes}
        for db_name in desired:
            await self.ensure_listener(db_name)
        for db_name in list(self._tasks):
            if db_name != REGISTRY_DB and db_name not in desired:
                await self.stop_listener(db_name)

    async def ensure_listener(self, database: str) -> None:
        if database in self._tasks and not self._tasks[database].done():
            return
        stop_event = asyncio.Event()
        self._stop_events[database] = stop_event
        task = asyncio.create_task(
            tail_database(self._couch, database, stop_event=stop_event),
            name=f"changes-{database}",
        )
        self._tasks[database] = task
        logger.info("Started listener for %s", database)

    async def stop_listener(self, database: str) -> None:
        stop_event = self._stop_events.pop(database, None)
        task = self._tasks.pop(database, None)
        if stop_event:
            stop_event.set()
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        logger.info("Stopped listener for %s", database)

    async def registry_watch_loop(self) -> None:
        """Periodically reconcile shelter listeners with registry state."""
        while True:
            try:
                await self.sync_open_shelters()
            except Exception:
                logger.exception("Failed to sync open shelter listeners")
            await asyncio.sleep(30)

    async def start(self) -> None:
        await self.ensure_listener(REGISTRY_DB)
        await self.sync_open_shelters()
        asyncio.create_task(self.registry_watch_loop(), name="registry-watch")

    async def stop_all(self) -> None:
        for db_name in list(self._tasks):
            await self.stop_listener(db_name)
