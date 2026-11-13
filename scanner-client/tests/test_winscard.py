"""winscard.dll through ctypes, tested against a fake dll that writes its out-params the way
the real one does (issue #1326: Smart App Control blocks pyscard's unsigned .pyd)."""

import ctypes

import pytest
from app.scard import CMD_CID, ReaderLostError

from scanner_client import winscard
from scanner_client.winscard import (
    SCARD_E_NO_READERS_AVAILABLE,
    SCARD_E_NO_SERVICE,
    SCARD_E_NO_SMARTCARD,
    SCARD_E_SERVICE_STOPPED,
    SCARD_E_TIMEOUT,
    SCARD_E_UNKNOWN_READER,
    SCARD_STATE_PRESENT,
    SCARD_STATE_UNAVAILABLE,
    WinSCard,
    WinSCardError,
    WinSCardThaiReader,
)

READER = "ACS ACR39U ICC Reader 0"
THAI_ID_ATR = [0x3B, 0x67, 0x00, 0x00, 0x73, 0x20, 0x00, 0x6C, 0x68, 0x90, 0x00]


def _signed(code: int) -> int:
    """The real dll returns LONG: error codes arrive negative."""
    return code - (1 << 32)


class FakeDll:
    def __init__(self, readers=(READER,)):
        self.readers = list(readers)
        self.event_state = SCARD_STATE_PRESENT
        self.atr = list(THAI_ID_ATR)
        self.protocol = winscard.SCARD_PROTOCOL_T0
        self.responses: dict[tuple[int, ...], list[int]] = {}
        self.results: dict[str, int] = {}
        self.open_contexts: set[int] = set()
        self.open_cards: set[int] = set()
        self.sent: list[tuple[int, list[int]]] = []
        self.status_queries: list[tuple[str, int]] = []
        self._next = 0x100

    def _result(self, name):
        return self.results.get(name, 0)

    def _new_handle(self):
        self._next += 1
        return self._next

    def SCardEstablishContext(self, scope, reserved1, reserved2, ph_context):
        if self._result("SCardEstablishContext"):
            return self._result("SCardEstablishContext")
        ph_context.contents.value = self._new_handle()
        self.open_contexts.add(ph_context.contents.value)
        return 0

    def SCardReleaseContext(self, context):
        self.open_contexts.discard(context)
        return 0

    def SCardListReadersW(self, context, groups, buffer, pcch):
        if self._result("SCardListReadersW"):
            return self._result("SCardListReadersW")
        if not self.readers:
            return _signed(SCARD_E_NO_READERS_AVAILABLE)
        multi = "".join(name + "\0" for name in self.readers) + "\0"
        if buffer is not None:
            if pcch.contents.value < len(multi):
                return _signed(winscard.SCARD_E_INSUFFICIENT_BUFFER)
            buffer[: len(multi)] = multi
        pcch.contents.value = len(multi)
        return 0

    def SCardGetStatusChangeW(self, context, timeout, states, count):
        if self._result("SCardGetStatusChangeW"):
            return self._result("SCardGetStatusChangeW")
        assert context in self.open_contexts
        self.status_queries.append((states[0].szReader, states[0].dwCurrentState))
        states[0].dwEventState = self.event_state
        return 0

    def SCardConnectW(self, context, reader, share, protocols, ph_card, p_protocol):
        if self._result("SCardConnectW"):
            return self._result("SCardConnectW")
        assert reader in self.readers
        ph_card.contents.value = self._new_handle()
        p_protocol.contents.value = self.protocol
        self.open_cards.add(ph_card.contents.value)
        return 0

    def SCardStatusW(self, card, name, pcch_name, p_state, p_protocol, atr, pcb_atr):
        assert card in self.open_cards
        atr[: len(self.atr)] = self.atr
        pcb_atr.contents.value = len(self.atr)
        return 0

    def SCardTransmit(self, card, send_pci, send, send_len, recv_pci, recv, pcb_recv):
        if self._result("SCardTransmit"):
            return self._result("SCardTransmit")
        assert card in self.open_cards
        apdu = list(send[:send_len])
        self.sent.append((send_pci.contents.dwProtocol, apdu))
        reply = self.responses.get(tuple(apdu), [0x90, 0x00])
        assert pcb_recv.contents.value >= len(reply)
        recv[: len(reply)] = reply
        pcb_recv.contents.value = len(reply)
        return 0

    def SCardDisconnect(self, card, disposition):
        self.open_cards.discard(card)
        return 0


@pytest.fixture
def dll():
    return FakeDll()


def test_list_reader_names_splits_the_multi_string_and_releases_its_context(dll):
    dll.readers = [READER, "Windows Hello for Business 1"]

    assert winscard.list_reader_names(WinSCard(dll)) == [READER, "Windows Hello for Business 1"]
    assert dll.open_contexts == set()


@pytest.mark.parametrize(
    "code", [SCARD_E_NO_READERS_AVAILABLE, SCARD_E_NO_SERVICE, SCARD_E_SERVICE_STOPPED]
)
def test_no_reader_plugged_in_lists_no_names(dll, code):
    # Windows stops the smart card service once the last reader is unplugged.
    dll.results["SCardListReadersW"] = _signed(code)

    assert winscard.list_reader_names(WinSCard(dll)) == []


def test_no_smart_card_service_at_all_lists_no_names(dll):
    dll.results["SCardEstablishContext"] = _signed(SCARD_E_NO_SERVICE)

    assert winscard.list_reader_names(WinSCard(dll)) == []


def test_other_list_failures_raise_with_the_code(dll):
    dll.results["SCardListReadersW"] = _signed(0x80100001)

    with pytest.raises(WinSCardError, match="0x80100001"):
        winscard.list_reader_names(WinSCard(dll))


def test_open_reader_out_of_range_releases_the_context(dll):
    with pytest.raises(IndexError):
        WinSCardThaiReader(reader_index=1, api=WinSCard(dll))
    assert dll.open_contexts == set()


def test_connect_reads_the_atr_and_selects_the_thai_applet_over_the_active_protocol(dll):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))

    assert reader.connect() is True

    assert reader.req_prefix == [0x00, 0xC0, 0x00, 0x01]  # ATR 3B 67 → the 0x01 variant
    protocol, apdu = dll.sent[0]
    assert protocol == winscard.SCARD_PROTOCOL_T0
    assert apdu[:5] == [0x00, 0xA4, 0x04, 0x00, 0x08]


def test_transmit_returns_data_and_status_words_like_pyscard(dll):
    dll.responses[tuple(CMD_CID)] = [0x61, 0x0D]
    dll.responses[(0x00, 0xC0, 0x00, 0x01, 0x0D)] = [ord(c) for c in "1234567890123"] + [0x90, 0x00]
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    reader.connect()

    assert reader.connection.transmit(CMD_CID) == ([], 0x61, 0x0D)
    assert reader.get_citizen_id() == "1234567890123"


def test_a_long_reply_fits_the_receive_buffer(dll):
    photo_piece = [0x80, 0xB0, 0x01, 0x7B, 0x02, 0x00, 0xFF]
    dll.responses[tuple(photo_piece)] = list(range(255)) + [0x90, 0x00]
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    reader.connect()

    data, sw1, sw2 = reader.connection.transmit(photo_piece)

    assert (len(data), sw1, sw2) == (255, 0x90, 0x00)


def test_t1_cards_get_the_t1_pci(dll):
    dll.protocol = winscard.SCARD_PROTOCOL_T1
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    reader.connect()

    assert dll.sent[0][0] == winscard.SCARD_PROTOCOL_T1


def test_reconnect_drops_the_previous_card_handle(dll):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    reader.connect()
    reader.connect()  # read_photo after the ID read connects again

    assert len(dll.open_cards) == 1


def test_connect_without_a_card_returns_false(dll):
    dll.results["SCardConnectW"] = _signed(SCARD_E_NO_SMARTCARD)
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))

    assert reader.connect() is False


def test_connect_on_an_unplugged_reader_raises_reader_lost(dll):
    dll.results["SCardConnectW"] = _signed(SCARD_E_UNKNOWN_READER)
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))

    with pytest.raises(ReaderLostError):
        reader.connect()


def test_close_disconnects_the_card_and_releases_the_context(dll):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    reader.connect()

    reader.close()
    reader.close()  # the watcher may close twice

    assert dll.open_cards == set()
    assert dll.open_contexts == set()


def test_is_card_inserted_polls_the_chosen_reader_without_waiting(dll):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))

    assert reader.is_card_inserted() is True
    assert dll.status_queries == [(READER, winscard.SCARD_STATE_UNAWARE)]

    dll.event_state = 0
    assert reader.is_card_inserted() is False


def test_a_swapped_card_reads_as_a_removal_once(dll):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    dll.event_state = SCARD_STATE_PRESENT | (1 << 16)
    assert reader.is_card_inserted() is True

    dll.event_state = SCARD_STATE_PRESENT | (3 << 16)  # pulled and another card put in
    assert reader.is_card_inserted() is False
    assert reader.is_card_inserted() is True


def test_an_unavailable_reader_state_raises_reader_lost(dll):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    dll.event_state = SCARD_STATE_UNAVAILABLE

    with pytest.raises(ReaderLostError):
        reader.is_card_inserted()


@pytest.mark.parametrize("code", [SCARD_E_SERVICE_STOPPED, SCARD_E_UNKNOWN_READER])
def test_a_vanished_reader_raises_reader_lost(dll, code):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    dll.results["SCardGetStatusChangeW"] = _signed(code)

    with pytest.raises(ReaderLostError):
        reader.is_card_inserted()


def test_poll_hiccups_keep_the_last_answer_until_too_many(dll):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    assert reader.is_card_inserted() is True
    dll.results["SCardGetStatusChangeW"] = _signed(SCARD_E_TIMEOUT)

    assert reader.is_card_inserted() is True
    assert reader.is_card_inserted() is True
    with pytest.raises(ReaderLostError):
        reader.is_card_inserted()


def test_polling_a_closed_reader_raises_reader_lost(dll):
    reader = WinSCardThaiReader(reader_index=0, api=WinSCard(dll))
    reader.close()

    with pytest.raises(ReaderLostError):
        reader.is_card_inserted()


def test_reader_state_struct_matches_the_windows_layout():
    # LPCWSTR, LPVOID, 3 × DWORD, BYTE[36] — 36, not pcsc-lite's 33.
    pointer = ctypes.sizeof(ctypes.c_void_p)
    assert winscard.SCARD_READERSTATEW.rgbAtr.size == 36
    assert winscard.SCARD_READERSTATEW.dwCurrentState.offset == 2 * pointer
    assert winscard.SCARD_READERSTATEW.rgbAtr.offset == 2 * pointer + 12


def test_load_is_windows_only(monkeypatch):
    monkeypatch.delattr(ctypes, "WinDLL", raising=False)

    with pytest.raises(OSError):
        WinSCard.load()
