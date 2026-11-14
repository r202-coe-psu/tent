import asyncio

import pytest
from app.scard import ReaderLostError

from scanner_client.reader_watch import CardReaderWatcher, pick_reader_index

WINDOWS_HELLO = "Windows Hello for Business 1"
USB_READER = "Generic Smart Card Reader 0"


@pytest.mark.parametrize(
    ("names", "preferred", "expected"),
    [
        ([USB_READER], None, 0),
        ([WINDOWS_HELLO, USB_READER], None, 1),
        (["Microsoft Virtual Smart Card 2", "Virtual Smart Card 1", USB_READER], None, 2),
        (["Microsoft TPM Smart Card 0", USB_READER], None, 1),
        ([WINDOWS_HELLO], None, None),
        ([], None, None),
        (["Other Reader 0", USB_READER], "generic smart", 1),
        ([WINDOWS_HELLO, USB_READER], "windows hello", 0),
        ([USB_READER], "ACS", None),
    ],
    ids=[
        "single real reader",
        "skips Windows Hello",
        "skips virtual smart cards",
        "skips TPM",
        "only virtual -> none",
        "no readers -> none",
        "preferred matches case-insensitively",
        "preferred wins even if virtual",
        "preferred not found -> none (no fallback)",
    ],
)
def test_pick_reader_index(names, preferred, expected):
    assert pick_reader_index(names, preferred) == expected


class FakeReader:
    """Scripted slot: each is_card_inserted() pops one item (bool, or an exception to raise).
    Draining the script (ending on a bool) stops the watcher, so scenarios end deterministically."""

    def __init__(self, script, stop):
        self._script = list(script)
        self._stop = stop
        self.closed = False

    def is_card_inserted(self):
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        if not self._script:
            self._stop.set()
        return item

    def close(self):
        self.closed = True


class Scenario:
    """Wires a CardReaderWatcher to scripted fakes and records what it did."""

    def __init__(self, names, reader_scripts=(), preferred=None, max_sleeps=None, open_errors=()):
        self.stop = asyncio.Event()
        self._names = list(names)
        self._reader_scripts = list(reader_scripts)
        self._open_errors = list(open_errors)
        self._max_sleeps = max_sleeps
        self.opened = []
        self.readers = []
        self.handled = []
        self.sleeps = []
        self.watcher = CardReaderWatcher(
            list_reader_names=self._list_reader_names,
            open_reader=self._open_reader,
            handle_card=self._handle_card,
            preferred_name=preferred,
            poll_interval=0.5,
            sleep=self._sleep,
        )

    def _list_reader_names(self):
        item = self._names.pop(0) if len(self._names) > 1 else self._names[0]
        if isinstance(item, Exception):
            raise item
        return item

    def _open_reader(self, index):
        self.opened.append(index)
        if self._open_errors:
            raise self._open_errors.pop(0)
        reader = FakeReader(self._reader_scripts.pop(0), self.stop)
        self.readers.append(reader)
        return reader

    async def _handle_card(self, reader):
        self.handled.append(reader)

    async def _sleep(self, seconds):
        self.sleeps.append(seconds)
        if self._max_sleeps is not None and len(self.sleeps) >= self._max_sleeps:
            self.stop.set()

    def run(self):
        asyncio.run(self.watcher.run(self.stop))


def test_waits_every_2s_with_no_reader_then_opens_it_when_one_appears():
    scenario = Scenario(
        names=[[], [], [WINDOWS_HELLO, USB_READER]],
        reader_scripts=[[False]],
    )

    scenario.run()

    assert scenario.opened == [1]
    assert scenario.sleeps[:2] == [2.0, 2.0]


def test_card_that_stays_inserted_is_handled_once():
    scenario = Scenario(names=[[USB_READER]], reader_scripts=[[False, True, True, True]])

    scenario.run()

    assert scenario.handled == [scenario.readers[0]]


def test_card_removed_then_inserted_again_is_handled_twice():
    scenario = Scenario(
        names=[[USB_READER]], reader_scripts=[[True, True, False, False, True, True]]
    )

    scenario.run()

    assert scenario.handled == [scenario.readers[0]] * 2


def test_reader_lost_mid_poll_closes_it_waits_2s_and_reopens():
    scenario = Scenario(
        names=[[USB_READER]],
        reader_scripts=[[False, ReaderLostError("unplugged")], [False, True]],
    )

    scenario.run()

    assert scenario.opened == [0, 0]
    assert scenario.readers[0].closed
    assert scenario.sleeps == [0.5, 2.0, 0.5, 0.5]
    assert scenario.handled == [scenario.readers[1]]


def test_configured_reader_name_not_found_keeps_waiting_without_opening_anything():
    scenario = Scenario(names=[[WINDOWS_HELLO, USB_READER]], preferred="ACS", max_sleeps=3)

    scenario.run()

    assert scenario.opened == []
    assert scenario.sleeps == [2.0, 2.0, 2.0]


def test_pyscard_errors_listing_or_opening_are_retried_every_2s():
    scenario = Scenario(
        names=[RuntimeError("pcscd not running"), [USB_READER]],
        reader_scripts=[[False]],
        open_errors=[RuntimeError("No Smart Card Reader detected")],
    )

    scenario.run()

    assert scenario.opened == [0, 0]
    assert scenario.sleeps[:2] == [2.0, 2.0]
