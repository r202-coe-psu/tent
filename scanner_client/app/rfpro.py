"""HOUSESmart / RFpro USB-HID contact-card reader (no PC/SC).

Implements the vendor frame format (RFpro SDK `通用协议规则`) and the contact-IC-card commands
(`接触式IC卡功能指令`) over /dev/hidraw, then reuses the Thai ID APDU logic of ThaiSmartCardReader.

Only an allowlist of read-only commands can ever be written to the device; the vendor's
reboot / flash-write / baud-rate commands are unreachable from here. Card data (APDU
payloads, ID number, names, address) is never logged — only command, status and lengths.
"""

from __future__ import annotations

import logging
import os
import select
import threading
import time
from dataclasses import dataclass
from typing import Callable

from app.hidraw import HidNode, find_nodes
from app.scard import ThaiSmartCardReader

logger = logging.getLogger(__name__)

STX = 0xAA
HEARTBEAT = b"\xff\xff"
SLOT_MAIN = 0x00
CARD_CPU_7816 = 0x0C
SLOT_POWER_OFF = 0x00
SLOT_POWER_ON = 0x01
DEFAULT_USB_ID = "0483:4c43"
COMMAND_TIMEOUT_SEC = 3.0
POWER_CYCLE_SETTLE_SEC = 0.3
# STX + INX + LEN(2) + CHK around the LEN bytes; replies are far smaller than this cap.
FRAME_OVERHEAD = 5
MAX_FRAME_LEN = 1024
# Consecutive unanswered polls before the module is treated as gone so the manager re-opens it.
MAX_POLL_FAILURES = 3

CMD_HW_VER = b"\x00\x00"
CMD_ICC_ST = b"\x18\x00"
CMD_ICC_SEL = b"\x18\x01"
CMD_ICC_SLOT_PWR = b"\x18\x02"
CMD_ICC_GETATR = b"\x18\x80"
CMD_ICC_APDU = b"\x18\x81"
ALLOWED_CMDS = frozenset(
    {CMD_HW_VER, CMD_ICC_ST, CMD_ICC_SEL, CMD_ICC_SLOT_PWR, CMD_ICC_GETATR, CMD_ICC_APDU}
)


class RfproError(RuntimeError):
    """Base class for reader failures; messages never carry card data."""


class RfproProtocolError(RfproError):
    """Malformed, unanswered or rejected command."""


class RfproCardError(RfproError):
    """The module answered but the card is absent or did not respond."""


class RfproDeviceLostError(RfproError):
    """The HID node vanished or failed (USB unplugged); the reader must be re-opened."""


def _xor(data: bytes) -> int:
    value = 0
    for byte in data:
        value ^= byte
    return value


def build_frame(inx: int, cmd: bytes, data: bytes = b"") -> bytes:
    """AA · INX · LEN(BE, = DEVICE+CMD+DATA) · DEVICE 0000 · CMD · DATA · XOR(INX..DATA)."""
    if cmd not in ALLOWED_CMDS:
        raise ValueError(f"command {cmd.hex()} is not in the read-only allowlist")
    body = bytes([inx & 0xFF]) + (4 + len(data)).to_bytes(2, "big") + b"\x00\x00" + cmd + data
    return bytes([STX]) + body + bytes([_xor(body)])


@dataclass(frozen=True)
class Reply:
    inx: int
    cmd: bytes
    status: int
    data: bytes


def parse_frame(buf: bytes) -> Reply | None:
    """Parse the frame at the start of `buf`; None while it is still incomplete.

    Replies carry one STATUS byte right after CMD (0x00 = success).
    """
    if len(buf) < 4:
        return None
    if buf[0] != STX:
        raise RfproProtocolError("frame does not start with STX")
    length = int.from_bytes(buf[2:4], "big")
    if length < 4 or length > MAX_FRAME_LEN:
        raise RfproProtocolError("frame length out of range")
    total = length + FRAME_OVERHEAD
    if len(buf) < total:
        return None
    frame = buf[:total]
    if _xor(frame[1:-1]) != frame[-1]:
        raise RfproProtocolError("frame checksum mismatch")
    if total < 10:  # no STATUS byte (header-only frame)
        return Reply(inx=frame[1], cmd=frame[6:8], status=0, data=b"")
    return Reply(inx=frame[1], cmd=frame[6:8], status=frame[8], data=frame[9:-1])


class RfproTransport:
    """Frames over one hidraw node; thread-safe, one command in flight at a time."""

    def __init__(
        self,
        fd: int,
        *,
        report_id: int = 0,
        out_size: int = 32,
        has_report_ids: bool = False,
        timeout: float = COMMAND_TIMEOUT_SEC,
    ) -> None:
        self._fd: int | None = fd
        self._report_id = report_id
        self._out_size = out_size
        self._has_report_ids = has_report_ids
        self._timeout = timeout
        self._inx = 0
        self._lock = threading.Lock()
        # Optional hook for the manual inspector: tracer(direction, cmd, status, data);
        # status is None for requests. Unused (and nothing logged) in the kiosk.
        self.tracer: Callable[[str, bytes, int | None, bytes], None] | None = None

    @classmethod
    def open(cls, usb_id: str = DEFAULT_USB_ID) -> "RfproTransport":
        nodes = [n for n in find_nodes(usb_id) if any(kind == "Output" for kind, _ in n.reports)]
        if not nodes:
            raise RfproDeviceLostError(f"card reader {usb_id} not found")
        node = nodes[0]
        try:
            fd = os.open(node.dev, os.O_RDWR | os.O_NONBLOCK)
        except PermissionError as error:
            raise RfproDeviceLostError(
                f"no permission to open {node.dev}: install the udev rule from the README "
                "(group plugdev), then log in again"
            ) from error
        except OSError as error:
            raise RfproDeviceLostError(f"cannot open {node.dev}") from error
        return cls._for_node(fd, node)

    @classmethod
    def _for_node(cls, fd: int, node: HidNode) -> "RfproTransport":
        report_id = next((rid for kind, rid in node.reports if kind == "Output"), 0)
        return cls(
            fd,
            report_id=report_id,
            out_size=node.output_bytes(report_id) or 64,
            has_report_ids=node.has_report_ids,
        )

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None

    def _lost(self, error: OSError) -> RfproDeviceLostError:
        self._close_locked()
        return RfproDeviceLostError(f"card reader I/O failed: {error.strerror or 'error'}")

    def _read_report(self, timeout: float) -> bytes | None:
        assert self._fd is not None
        ready, _, _ = select.select([self._fd], [], [], timeout)
        if not ready:
            return None
        report = os.read(self._fd, 512)
        if not report:
            raise OSError("end of file")
        return report[1:] if self._has_report_ids else report

    def _drain(self) -> None:
        """Drop stale reports (heartbeats, a late reply to a timed-out command)."""
        while self._read_report(0) is not None:
            pass

    def _write(self, frame: bytes) -> None:
        assert self._fd is not None
        for start in range(0, len(frame), self._out_size):
            chunk = frame[start : start + self._out_size]
            os.write(self._fd, bytes([self._report_id]) + chunk.ljust(self._out_size, b"\x00"))

    def command(self, cmd: bytes, data: bytes = b"", timeout: float | None = None) -> Reply:
        with self._lock:
            if self._fd is None:
                raise RfproDeviceLostError("card reader is closed")
            self._inx = (self._inx % 255) + 1
            frame = build_frame(self._inx, cmd, data)  # rejects commands outside the allowlist
            budget = self._timeout if timeout is None else timeout
            try:
                self._drain()
                if self.tracer:
                    self.tracer("TX", cmd, None, data)
                self._write(frame)
                reply = self._await_reply(cmd, budget)
            except OSError as error:
                raise self._lost(error) from error
            if self.tracer:
                self.tracer("RX", cmd, reply.status, reply.data)
            logger.debug("rfpro cmd=%s status=%02x data_len=%d", cmd.hex(), reply.status, len(reply.data))
            return reply

    def _await_reply(self, cmd: bytes, budget: float) -> Reply:
        deadline = time.monotonic() + budget
        buf = b""
        while (left := deadline - time.monotonic()) > 0:
            report = self._read_report(left)
            if report is None:
                break
            if not buf:
                # A frame starts at STX; anything before it (padding, strays) is dropped.
                start = report.find(bytes([STX]))
                if start < 0:
                    continue
                report = report[start:]
            buf += report
            reply = parse_frame(buf)
            if reply is None:
                continue  # the frame spans more reports
            buf = b""
            if reply.cmd == HEARTBEAT or reply.cmd != cmd:
                continue
            return reply
        raise RfproProtocolError(f"no reply to command {cmd.hex()} within {budget:.0f}s")


class RfproConnection:
    """The slice of the pyscard connection API that ThaiSmartCardReader uses."""

    def __init__(self, transport: RfproTransport) -> None:
        self._transport = transport
        self._atr: list[int] = []

    def _select_and_reset(self) -> Reply:
        self._transport.command(CMD_ICC_SEL, bytes([SLOT_MAIN, CARD_CPU_7816]))
        return self._transport.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))

    def connect(self) -> None:
        reply = self._select_and_reset()
        if reply.status != 0x00:
            # Some insertions answer a bare reset with an undocumented status (seen: 0x11);
            # cycling slot power once clears it.
            for action in (SLOT_POWER_OFF, SLOT_POWER_ON):
                self._transport.command(CMD_ICC_SLOT_PWR, bytes([SLOT_MAIN, action]))
                time.sleep(POWER_CYCLE_SETTLE_SEC)
            reply = self._transport.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))
        if reply.status != 0x00 or not reply.data:
            raise RfproCardError(f"card did not answer reset (status 0x{reply.status:02x})")
        self._atr = list(reply.data)

    def getATR(self) -> list[int]:
        return list(self._atr)

    def transmit(self, apdu: list[int]) -> tuple[list[int], int, int]:
        reply = self._transport.command(CMD_ICC_APDU, bytes([SLOT_MAIN]) + bytes(apdu))
        if reply.status != 0x00 or len(reply.data) < 2:
            raise RfproCardError(f"APDU exchange failed (status 0x{reply.status:02x})")
        return list(reply.data[:-2]), reply.data[-2], reply.data[-1]

    def disconnect(self) -> None:
        self._transport.command(CMD_ICC_SLOT_PWR, bytes([SLOT_MAIN, SLOT_POWER_OFF]))


class RfproThaiCardReader(ThaiSmartCardReader):
    """Thai national ID reader on the RFpro module; same API as the PC/SC reader."""

    def __init__(self, usb_id: str = DEFAULT_USB_ID, transport: RfproTransport | None = None):
        self.transport = transport or RfproTransport.open(usb_id)
        super().__init__(connection=RfproConnection(self.transport))
        self._poll_failures = 0
        try:
            version = self.transport.command(CMD_HW_VER)
        except RfproError:
            self.transport.close()
            raise
        logger.info(
            "Initialized RFpro card reader (firmware %s)",
            version.data.decode("ascii", errors="replace").strip("\x00 "),
        )

    def close(self) -> None:
        self.transport.close()

    def is_card_inserted(self) -> bool:
        """Poll the slot switch only — never resets the card on each poll."""
        try:
            reply = self.transport.command(CMD_ICC_ST, bytes([SLOT_MAIN]))
        except RfproDeviceLostError:
            raise
        except RfproError:
            self._poll_failures += 1
            if self._poll_failures >= MAX_POLL_FAILURES:
                self._poll_failures = 0
                raise RfproDeviceLostError("card reader stopped answering") from None
            return False
        self._poll_failures = 0
        return reply.status == 0x00 and bool(reply.data) and bool(reply.data[0] & 0x01)
