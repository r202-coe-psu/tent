"""PC/SC on Windows through ctypes and the system winscard.dll (issue #1326).

Smart App Control blocks pyscard's unsigned `_scard.pyd`, so on Windows the client talks to
winscard.dll (signed by Microsoft) directly and ships no native file of its own for the reader.
The APDU and decoding logic stays in the kiosk's ThaiSmartCardReader; this module only supplies
its `connection` and the slot poll. Card data is never logged.
"""

from __future__ import annotations

import ctypes
import logging
from collections.abc import Callable
from ctypes import POINTER, Structure, c_size_t, c_ubyte, c_uint32, c_void_p, c_wchar_p
from typing import Any

from app.scard import MAX_POLL_FAILURES, ReaderLostError, ThaiSmartCardReader

logger = logging.getLogger(__name__)

DWORD = c_uint32
SCARDCONTEXT = c_size_t  # ULONG_PTR
SCARDHANDLE = c_size_t

SCARD_S_SUCCESS = 0
SCARD_SCOPE_USER = 0
SCARD_SHARE_SHARED = 2
SCARD_PROTOCOL_T0 = 1
SCARD_PROTOCOL_T1 = 2
SCARD_LEAVE_CARD = 0
SCARD_STATE_UNAWARE = 0x00
SCARD_STATE_UNKNOWN = 0x04
SCARD_STATE_UNAVAILABLE = 0x08
SCARD_STATE_PRESENT = 0x20

SCARD_E_INVALID_HANDLE = 0x80100003
SCARD_E_INSUFFICIENT_BUFFER = 0x80100008
SCARD_E_UNKNOWN_READER = 0x80100009
SCARD_E_TIMEOUT = 0x8010000A
SCARD_E_NO_SMARTCARD = 0x8010000C
SCARD_E_READER_UNAVAILABLE = 0x80100017
SCARD_E_NO_SERVICE = 0x8010001D
SCARD_E_SERVICE_STOPPED = 0x8010001E
SCARD_E_NO_READERS_AVAILABLE = 0x8010002E

_READER_LOST_CODES = frozenset(
    {
        SCARD_E_NO_SERVICE,
        SCARD_E_SERVICE_STOPPED,
        SCARD_E_INVALID_HANDLE,
        SCARD_E_UNKNOWN_READER,
        SCARD_E_READER_UNAVAILABLE,
        SCARD_E_NO_READERS_AVAILABLE,
    }
)
# Windows stops the smart card service once the last reader is unplugged.
_NO_READER_CODES = frozenset(
    {SCARD_E_NO_READERS_AVAILABLE, SCARD_E_NO_SERVICE, SCARD_E_SERVICE_STOPPED}
)

MAX_ATR_SIZE = 36
RECV_BUFFER_SIZE = 258  # 256 data bytes + SW1 SW2
READER_NAME_BUFFER = 1024
LIST_READERS_ATTEMPTS = 3  # a reader plugged in between the size query and the read


class SCARD_READERSTATEW(Structure):
    _fields_ = [
        ("szReader", c_wchar_p),
        ("pvUserData", c_void_p),
        ("dwCurrentState", DWORD),
        ("dwEventState", DWORD),
        ("cbAtr", DWORD),
        ("rgbAtr", c_ubyte * MAX_ATR_SIZE),
    ]


class SCARD_IO_REQUEST(Structure):
    _fields_ = [("dwProtocol", DWORD), ("cbPciLength", DWORD)]


_PROTOTYPES = {
    "SCardEstablishContext": [DWORD, c_void_p, c_void_p, POINTER(SCARDCONTEXT)],
    "SCardReleaseContext": [SCARDCONTEXT],
    "SCardListReadersW": [SCARDCONTEXT, c_wchar_p, c_wchar_p, POINTER(DWORD)],
    "SCardGetStatusChangeW": [SCARDCONTEXT, DWORD, POINTER(SCARD_READERSTATEW), DWORD],
    "SCardConnectW": [
        SCARDCONTEXT,
        c_wchar_p,
        DWORD,
        DWORD,
        POINTER(SCARDHANDLE),
        POINTER(DWORD),
    ],
    "SCardStatusW": [
        SCARDHANDLE,
        c_wchar_p,
        POINTER(DWORD),
        POINTER(DWORD),
        POINTER(DWORD),
        POINTER(c_ubyte),
        POINTER(DWORD),
    ],
    "SCardTransmit": [
        SCARDHANDLE,
        POINTER(SCARD_IO_REQUEST),
        POINTER(c_ubyte),
        DWORD,
        POINTER(SCARD_IO_REQUEST),
        POINTER(c_ubyte),
        POINTER(DWORD),
    ],
    "SCardDisconnect": [SCARDHANDLE, DWORD],
}


class WinSCardError(RuntimeError):
    def __init__(self, function: str, code: int):
        super().__init__(f"{function} failed (0x{code:08X})")
        self.code = code


class WinSCardReaderLostError(WinSCardError, ReaderLostError):
    """The reader or the smart card service went away; the watcher re-opens the reader."""


def _error(function: str, code: int) -> WinSCardError:
    if code in _READER_LOST_CODES:
        return WinSCardReaderLostError(function, code)
    return WinSCardError(function, code)


class WinSCard:
    """The few SCard calls the client needs, as Python values. `dll` is winscard.dll (or a
    fake with the same functions); out-params are passed as ctypes pointers."""

    def __init__(self, dll: Any):
        self._dll = dll

    @classmethod
    def load(cls) -> WinSCard:
        win_dll: Callable[[str], Any] | None = getattr(ctypes, "WinDLL", None)
        if win_dll is None:
            raise OSError("winscard.dll is only available on Windows")
        dll = win_dll("winscard.dll")
        for name, argtypes in _PROTOTYPES.items():
            function = getattr(dll, name)
            function.argtypes = argtypes
            function.restype = ctypes.c_int32  # LONG
        return cls(dll)

    def _call(self, name: str, *args: Any) -> int:
        return getattr(self._dll, name)(*args) & 0xFFFFFFFF

    def _check(self, name: str, *args: Any) -> None:
        code = self._call(name, *args)
        if code != SCARD_S_SUCCESS:
            raise _error(name, code)

    def establish_context(self) -> int:
        context = SCARDCONTEXT()
        self._check("SCardEstablishContext", SCARD_SCOPE_USER, None, None, ctypes.pointer(context))
        return context.value

    def release_context(self, context: int) -> None:
        self._check("SCardReleaseContext", context)

    def list_readers(self, context: int) -> list[str]:
        for _ in range(LIST_READERS_ATTEMPTS):
            size = DWORD()
            self._check("SCardListReadersW", context, None, None, ctypes.pointer(size))
            buffer = ctypes.create_unicode_buffer(size.value)
            code = self._call("SCardListReadersW", context, None, buffer, ctypes.pointer(size))
            if code == SCARD_E_INSUFFICIENT_BUFFER:
                continue
            if code != SCARD_S_SUCCESS:
                raise _error("SCardListReadersW", code)
            return [name for name in buffer[: size.value].split("\0") if name]
        raise _error("SCardListReadersW", SCARD_E_INSUFFICIENT_BUFFER)

    def event_state(self, context: int, reader: str) -> int:
        """The reader's current state flags, without waiting for a change."""
        states = (SCARD_READERSTATEW * 1)()
        states[0].szReader = reader
        states[0].dwCurrentState = SCARD_STATE_UNAWARE
        self._check("SCardGetStatusChangeW", context, 0, states, 1)
        return states[0].dwEventState

    def connect(self, context: int, reader: str) -> tuple[int, int]:
        """(card handle, active protocol)."""
        card = SCARDHANDLE()
        protocol = DWORD()
        self._check(
            "SCardConnectW",
            context,
            reader,
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
            ctypes.pointer(card),
            ctypes.pointer(protocol),
        )
        return card.value, protocol.value

    def atr(self, card: int) -> list[int]:
        name = ctypes.create_unicode_buffer(READER_NAME_BUFFER)
        name_len = DWORD(READER_NAME_BUFFER)
        state = DWORD()
        protocol = DWORD()
        atr = (c_ubyte * MAX_ATR_SIZE)()
        atr_len = DWORD(MAX_ATR_SIZE)
        self._check(
            "SCardStatusW",
            card,
            name,
            ctypes.pointer(name_len),
            ctypes.pointer(state),
            ctypes.pointer(protocol),
            atr,
            ctypes.pointer(atr_len),
        )
        return list(atr[: atr_len.value])

    def transmit(self, card: int, protocol: int, apdu: list[int]) -> tuple[list[int], int, int]:
        """(data, sw1, sw2), the shape pyscard's transmit returns."""
        pci = SCARD_IO_REQUEST(protocol, ctypes.sizeof(SCARD_IO_REQUEST))
        send = (c_ubyte * len(apdu))(*apdu)
        recv = (c_ubyte * RECV_BUFFER_SIZE)()
        recv_len = DWORD(RECV_BUFFER_SIZE)
        self._check(
            "SCardTransmit",
            card,
            ctypes.pointer(pci),
            send,
            len(apdu),
            None,
            recv,
            ctypes.pointer(recv_len),
        )
        reply = list(recv[: recv_len.value])
        if len(reply) < 2:
            raise WinSCardError("SCardTransmit", SCARD_S_SUCCESS)
        return reply[:-2], reply[-2], reply[-1]

    def disconnect(self, card: int) -> None:
        self._check("SCardDisconnect", card, SCARD_LEAVE_CARD)


def list_reader_names(api: WinSCard | None = None) -> list[str]:
    """Reader names in the order WinSCardThaiReader indexes them; [] when none is plugged in."""
    api = api or WinSCard.load()
    try:
        context = api.establish_context()
    except WinSCardError as error:
        if error.code in _NO_READER_CODES:
            return []
        raise
    try:
        return api.list_readers(context)
    except WinSCardError as error:
        if error.code in _NO_READER_CODES:
            return []
        raise
    finally:
        api.release_context(context)


class WinSCardConnection:
    """connect() / getATR() / transmit() as ThaiSmartCardReader expects from pyscard."""

    def __init__(self, api: WinSCard, context: int, reader: str):
        self._api = api
        self._context = context
        self._reader = reader
        self._card: int | None = None
        self._protocol = SCARD_PROTOCOL_T0

    def connect(self) -> None:
        self.disconnect()  # the base reader only drops old handles for pyscard readers
        self._card, self._protocol = self._api.connect(self._context, self._reader)

    def getATR(self) -> list[int]:  # noqa: N802 - pyscard's name
        return self._api.atr(self._connected_card())

    def transmit(self, apdu: list[int]) -> tuple[list[int], int, int]:
        return self._api.transmit(self._connected_card(), self._protocol, apdu)

    def disconnect(self) -> None:
        if self._card is None:
            return
        card, self._card = self._card, None
        try:
            self._api.disconnect(card)
        except WinSCardError:
            pass  # the card was pulled or the service restarted: the handle is already gone

    def _connected_card(self) -> int:
        if self._card is None:
            raise WinSCardError("not connected", SCARD_E_INVALID_HANDLE)
        return self._card


class WinSCardThaiReader(ThaiSmartCardReader):
    """The kiosk's Thai ID reader over winscard.dll instead of pyscard."""

    def __init__(self, reader_index: int = 0, api: WinSCard | None = None):
        self._api = api or WinSCard.load()
        context = self._api.establish_context()
        try:
            names = self._api.list_readers(context)
            if reader_index >= len(names):
                raise IndexError(
                    f"Reader index {reader_index} out of range (found {len(names)} readers)"
                )
        except BaseException:
            self._api.release_context(context)
            raise
        self.reader_name = names[reader_index]
        super().__init__(
            reader_index=reader_index,
            connection=WinSCardConnection(self._api, context, self.reader_name),
        )
        self._context: int | None = context
        logger.info("Initialized Smart Card Reader: %s", self.reader_name)

    def close(self) -> None:
        if self._context is None:
            return
        context, self._context = self._context, None
        self.connection.disconnect()
        try:
            self._api.release_context(context)
        except WinSCardError:
            pass

    def is_card_inserted(self) -> bool:
        """Same rules as the kiosk's pyscard poll (app.scard.ThaiSmartCardReader)."""
        if self._context is None:
            raise ReaderLostError("card reader is closed")
        try:
            event_state = self._api.event_state(self._context, self.reader_name)
        except WinSCardReaderLostError:
            raise
        except WinSCardError:
            self._poll_failures += 1
            if self._poll_failures >= MAX_POLL_FAILURES:
                self._poll_failures = 0
                raise ReaderLostError("card reader stopped answering status polls") from None
            # A hiccup says nothing about the slot: reporting "empty" would end a removal wait.
            return self._last_present
        self._poll_failures = 0
        if event_state & (SCARD_STATE_UNKNOWN | SCARD_STATE_UNAVAILABLE):
            raise ReaderLostError("card reader is no longer available")
        present = bool(event_state & SCARD_STATE_PRESENT)
        event_count = (event_state >> 16) & 0xFFFF
        swapped = (
            present
            and self._last_present
            and self._last_event_count is not None
            and event_count != self._last_event_count
        )
        self._last_event_count = event_count
        self._last_present = present
        return present and not swapped
