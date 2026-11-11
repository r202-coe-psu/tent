"""Pick a PC/SC reader and watch it for card insertions (issue #1326)."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.scard import ReaderLostError  # reused from the kiosk, not copied

log = logging.getLogger(__name__)

# Windows exposes TPM-backed virtual smart cards as "readers"; they never hold an ID card.
_VIRTUAL_MARKERS = ("windows hello", "virtual smart card", "tpm")


def pick_reader_index(names: list[str], preferred: str | None) -> int | None:
    """First reader whose name contains `preferred` (case-insensitive); with no preference,
    the first non-virtual reader. None when nothing matches."""
    for index, name in enumerate(names):
        lowered = name.lower()
        if preferred:
            if preferred.lower() in lowered:
                return index
        elif not any(marker in lowered for marker in _VIRTUAL_MARKERS):
            return index
    return None


RETRY_INTERVAL_S = 2.0  # same cadence as the kiosk's reader (re)open loop


class CardReaderWatcher:
    """Opens the chosen reader, hands each inserted card to `handle_card(reader)` once, and
    keeps going when the reader is missing or unplugged. Stops when `stop` is set.

    The reader seam is injected: `list_reader_names() -> list[str]`, `open_reader(index)`
    returning an object with `is_card_inserted()` / `close()` (the kiosk's ThaiSmartCardReader).
    """

    def __init__(
        self,
        list_reader_names: Callable[[], list[str]],
        open_reader: Callable[[int], Any],
        handle_card: Callable[[Any], Awaitable[None]],
        preferred_name: str | None = None,
        poll_interval: float = 0.5,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self._list_reader_names = list_reader_names
        self._open_reader = open_reader
        self._handle_card = handle_card
        self._preferred_name = preferred_name
        self._poll_interval = poll_interval
        self._sleep = sleep

    async def run(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            reader = await self._open_preferred_reader()
            if reader is None:
                await self._sleep(RETRY_INTERVAL_S)
                continue
            try:
                await self._watch(reader, stop)
            except ReaderLostError:
                log.warning("card reader lost; retrying")
            finally:
                await asyncio.to_thread(reader.close)
            if not stop.is_set():
                await self._sleep(RETRY_INTERVAL_S)

    async def _open_preferred_reader(self) -> Any | None:
        try:
            names = await asyncio.to_thread(self._list_reader_names)
            index = pick_reader_index(names, self._preferred_name)
            if index is None:
                return None
            return await asyncio.to_thread(self._open_reader, index)
        except Exception as exc:  # pyscard missing, pcscd down, no reader: all just "not yet"
            log.warning("card reader not available: %s", exc)
            return None

    async def _watch(self, reader: Any, stop: asyncio.Event) -> None:
        handled = False  # the card now in the slot was already handed over
        while not stop.is_set():
            inserted = await asyncio.to_thread(reader.is_card_inserted)
            if inserted and not handled:
                await self._handle_card(reader)
            handled = inserted
            await self._sleep(self._poll_interval)
