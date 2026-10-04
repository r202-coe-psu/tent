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
from collections.abc import Callable
from dataclasses import dataclass

from app.config import DEFAULT_CARD_READER_USB_ID
from app.hidraw import HidNode, find_nodes
from app.scard import CMD_PHOTOS, ReaderLostError, ThaiSmartCardReader

logger = logging.getLogger(__name__)

STX = 0xAA
HEARTBEAT = b"\xff\xff"
SLOT_MAIN = 0x00
CARD_CPU_7816 = 0x0C
SLOT_POWER_OFF = 0x00
SLOT_POWER_ON = 0x01
DEFAULT_USB_ID = DEFAULT_CARD_READER_USB_ID
COMMAND_TIMEOUT_SEC = 3.0
POWER_CYCLE_SETTLE_SEC = 0.3
# STX + INX + LEN(2) + CHK around the LEN bytes; replies are far smaller than this cap.
FRAME_OVERHEAD = 5
MAX_FRAME_LEN = 1024
# The module answers with ONE 32-byte input report; of a longer frame only the first report
# arrives by itself (kiosk3: a 112-byte frame delivered 32 bytes, nothing after). A reply frame is
# STX+INX+LEN(2)+DEVICE(2)+CMD(2)+STATUS+CHK = 10 bytes around the card data, and the card's
# SW1 SW2 ride inside that data, so a report holds in_size - 12 bytes of card data.
REPLY_FRAME_OVERHEAD = 12
# ...but a longer reply is not lost: the module hands out the rest one report per FE FF request
# (CMD_NEXT_REPORT), so the transport now reads a whole 255-byte card field in one exchange.
# Measured on kiosk3: Le 255 = 9 reports, the data matches the 20-byte pieces, ~1.4 ms/byte
# (the card line at 9600 baud), so the Thai ID photo takes ~8 s instead of ~17 s.
MAX_PIECE_SIZE = 255
# Reading the photo piece by piece is slow; past this the photo is dropped and registration
# goes on without it.
PHOTO_BUDGET_SEC = 30.0
# Card resets allowed while reading one photo. kiosk3 saw a single photo piece fail with an
# undocumented status (0x44) mid-read; dropping the photo for one bad piece lost it entirely.
MAX_PHOTO_RECOVERIES = 3
# INS of GET RESPONSE. Under T=0 the card echoes it as the ACK procedure byte; this module also
# swallows a FIRST DATA byte equal to it (kiosk3: the 20-byte piece at 0x0a9a came back 19 bytes,
# SW 90 00; a 2-byte read from 0x0a99 showed the missing byte is C0). C0 is "ภ" in TIS-620.
GET_RESPONSE_INS = 0xC0
# Consecutive unanswered polls before the module is treated as gone so the manager re-opens it.
MAX_POLL_FAILURES = 3

CMD_HW_VER = b"\x00\x00"
CMD_ICC_ST = b"\x18\x00"
CMD_ICC_SEL = b"\x18\x01"
CMD_ICC_SLOT_PWR = b"\x18\x02"
CMD_ICC_GETATR = b"\x18\x80"
CMD_ICC_APDU = b"\x18\x81"
# Not in the vendor documents. Seen in usbmon traffic of the vendor library (libcomPro.so over
# hiddev): after a reply whose frame is longer than one 32-byte input report, the library sends
# `AA <same INX> 00 04 00 00 FE FF <CHK>` and the module answers with the next raw report.
# Without it only the first report of a long reply ever arrives.
CMD_NEXT_REPORT = b"\xfe\xff"
ALLOWED_CMDS = frozenset(
    {
        CMD_HW_VER,
        CMD_ICC_ST,
        CMD_ICC_SEL,
        CMD_ICC_SLOT_PWR,
        CMD_ICC_GETATR,
        CMD_ICC_APDU,
        CMD_NEXT_REPORT,
    }
)


class RfproError(RuntimeError):
    """Base class for reader failures; messages never carry card data."""


class RfproProtocolError(RfproError):
    """Malformed, unanswered or rejected command."""


class RfproCardError(RfproError):
    """The module answered but the card is absent or did not respond."""


class RfproDeviceLostError(RfproError, ReaderLostError):
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
    body = (
        bytes([inx & 0xFF])
        + (4 + len(data)).to_bytes(2, "big")
        + b"\x00\x00"
        + cmd
        + data
    )
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
        in_size: int = 32,
        timeout: float = COMMAND_TIMEOUT_SEC,
    ) -> None:
        self._fd: int | None = fd
        self._report_id = report_id
        self._out_size = out_size
        self._has_report_ids = has_report_ids
        self.in_size = in_size
        self._timeout = timeout
        self._inx = 0
        self._lock = threading.Lock()
        # Optional hook for the manual inspector: tracer(direction, cmd, status, data);
        # status is None for requests. Unused (and nothing logged) in the kiosk.
        self.tracer: Callable[[str, bytes, int | None, bytes], None] | None = None

    @classmethod
    def open(cls, usb_id: str = DEFAULT_USB_ID) -> RfproTransport:
        nodes = [
            n
            for n in find_nodes(usb_id)
            if any(kind == "Output" for kind, _ in n.reports)
        ]
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
    def _for_node(cls, fd: int, node: HidNode) -> RfproTransport:
        report_id = next((rid for kind, rid in node.reports if kind == "Output"), 0)
        input_id = next((rid for kind, rid in node.reports if kind == "Input"), 0)
        return cls(
            fd,
            report_id=report_id,
            out_size=node.output_bytes(report_id) or 64,
            has_report_ids=node.has_report_ids,
            in_size=node.input_bytes(input_id) or 32,
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
        return RfproDeviceLostError(
            f"card reader I/O failed: {error.strerror or 'error'}"
        )

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
            os.write(
                self._fd,
                bytes([self._report_id]) + chunk.ljust(self._out_size, b"\x00"),
            )

    def command(
        self, cmd: bytes, data: bytes = b"", timeout: float | None = None
    ) -> Reply:
        with self._lock:
            if self._fd is None:
                raise RfproDeviceLostError("card reader is closed")
            self._inx = (self._inx % 255) + 1
            frame = build_frame(
                self._inx, cmd, data
            )  # rejects commands outside the allowlist
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
            logger.debug(
                "rfpro cmd=%s status=%02x data_len=%d",
                cmd.hex(),
                reply.status,
                len(reply.data),
            )
            return reply

    @staticmethod
    def _extract(buf: bytes) -> tuple[Reply | None, bytes]:
        """Next complete frame in `buf`. A corrupt frame is skipped by resyncing on the next
        STX, so one bad report does not fail the whole command."""
        while buf:
            try:
                reply = parse_frame(buf)
            except RfproProtocolError:
                nxt = buf.find(bytes([STX]), 1)
                buf = buf[nxt:] if nxt > 0 else b""
                continue
            return (reply, b"") if reply is not None else (None, buf)
        return None, b""

    @staticmethod
    def _is_interleaved_heartbeat(report: bytes) -> bool:
        """A heartbeat can land between the reports of a longer reply. Only a report that is
        itself a complete, checksum-valid heartbeat frame counts: a continuation chunk that
        merely starts with 0xAA will not."""
        if report[:1] != bytes([STX]):
            return False
        try:
            frame = parse_frame(report)
        except RfproProtocolError:
            return False
        return frame is not None and frame.cmd == HEARTBEAT

    @staticmethod
    def _is_next_report_refusal(report: bytes) -> bool:
        """A module without paging answers FE FF as an unknown command with a frame of its own."""
        if report[:1] != bytes([STX]):
            return False
        try:
            frame = parse_frame(report)
        except RfproProtocolError:
            return False
        return frame is not None and frame.cmd == CMD_NEXT_REPORT

    def _await_reply(self, cmd: bytes, budget: float) -> Reply:
        deadline = time.monotonic() + budget
        buf = b""
        while (left := deadline - time.monotonic()) > 0:
            report = self._read_report(left)
            if report is None:
                break
            if buf and self._is_interleaved_heartbeat(report):
                continue
            if not buf:
                # A frame starts at STX; anything before it (padding, strays) is dropped.
                start = report.find(bytes([STX]))
                if start < 0:
                    continue
                report = report[start:]
            if buf and self._is_next_report_refusal(report):
                raise RfproProtocolError("module does not support FE FF paged replies")
            reply, buf = self._extract(buf + report)
            if reply is None:
                if buf:
                    # A reply longer than one report: the module sends only the first and hands
                    # out each next one when asked (see CMD_NEXT_REPORT).
                    self._write(build_frame(self._inx, CMD_NEXT_REPORT))
                continue  # the frame spans more reports (or the fragment was corrupt)
            # The device echoes INX, so a late reply to an earlier command is not ours.
            if reply.cmd == HEARTBEAT or reply.cmd != cmd or reply.inx != self._inx:
                continue
            return reply
        raise RfproProtocolError(
            f"no reply to command {cmd.hex()} within {budget:.0f}s"
        )


class RfproConnection:
    """The slice of the pyscard connection API that ThaiSmartCardReader uses."""

    def __init__(self, transport: RfproTransport) -> None:
        self._transport = transport
        self._atr: list[int] = []

    def _select_and_reset(self) -> Reply:
        self._transport.command(CMD_ICC_SEL, bytes([SLOT_MAIN, CARD_CPU_7816]))
        return self._transport.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))

    def power_cycle(self) -> None:
        """Cut and restore slot power: electrically the same as pulling the card and
        re-inserting it."""
        for action in (SLOT_POWER_OFF, SLOT_POWER_ON):
            self._transport.command(CMD_ICC_SLOT_PWR, bytes([SLOT_MAIN, action]))
            time.sleep(POWER_CYCLE_SETTLE_SEC)

    def connect(self) -> None:
        try:
            reply: Reply | None = self._select_and_reset()
        except RfproProtocolError:
            # A card still sliding in when the slot switch trips can leave the first reset
            # unanswered (seen on kiosk3: no reply to 18 80 for the whole command timeout).
            # The wait already gave it time to seat, so treat it like a refused reset.
            reply = None
        if reply is None or reply.status != 0x00:
            # Some insertions answer a bare reset with an undocumented status (seen: 0x11);
            # cycling slot power once clears it.
            self.power_cycle()
            reply = self._transport.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))
        if reply.status != 0x00 or not reply.data:
            raise RfproCardError(
                f"card did not answer reset (status 0x{reply.status:02x})"
            )
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

    def __init__(
        self, usb_id: str = DEFAULT_USB_ID, transport: RfproTransport | None = None
    ):
        self.transport = transport or RfproTransport.open(usb_id)
        super().__init__(connection=RfproConnection(self.transport))
        self._poll_failures = 0
        # Most card data one exchange asks for; a longer field is read in pieces of this size.
        # What one report holds is the size to drop to if the paged replies ever fail.
        self._single_report_piece = max(1, self.transport.in_size - REPLY_FRAME_OVERHEAD)
        self.piece_size = MAX_PIECE_SIZE
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

    def read_all_data(self, progress=None) -> dict:
        """A card left in since the ID read only read in full on kiosk3 after being pulled and
        re-inserted (the photo failed mid-way with 0x44 / 0x41, then 0x20). Start the full read
        from a cold power-up, as a re-insert would."""
        self.connection.power_cycle()
        return super().read_all_data(progress)

    def _read_piece(self, offset: int, length: int) -> list[int] | None:
        """READ BINARY of `length` bytes at `offset` + GET RESPONSE; None if the card has no data
        there (SW1 is not 61)."""
        _, sw1, sw2 = self.connection.transmit(
            [0x80, 0xB0, (offset >> 8) & 0xFF, offset & 0xFF, 0x02, 0x00, length]
        )
        if sw1 != 0x61:
            return None
        data, _, _ = self.connection.transmit(self.req_prefix + [sw2])
        return self._restore_leading_ins(offset, sw2, data)

    def _restore_leading_ins(self, offset: int, expected: int, data: list[int]) -> list[int]:
        """Put back a leading C0 the module swallowed (see GET_RESPONSE_INS), but only once a
        read starting one byte earlier shows the byte at `offset` really is C0: in that read it
        is no longer the first byte (or, if the byte before is C0 too, that one is swallowed
        instead), so it comes back as the last byte."""
        if len(data) != expected - 1 or offset == 0:
            return data
        _, sw1, sw2 = self.connection.transmit(
            [0x80, 0xB0, ((offset - 1) >> 8) & 0xFF, (offset - 1) & 0xFF, 0x02, 0x00, 2]
        )
        if sw1 != 0x61:
            return data
        probe, _, _ = self.connection.transmit(self.req_prefix + [sw2])
        if probe and probe[-1] == GET_RESPONSE_INS:
            return [GET_RESPONSE_INS, *data]
        return data

    def _read_photo_piece(self, offset: int, length: int) -> list[int]:
        """`_read_piece` that accepts only exactly `length` bytes with SW 90 00."""
        _, sw1, sw2 = self.connection.transmit(
            [0x80, 0xB0, (offset >> 8) & 0xFF, offset & 0xFF, 0x02, 0x00, length]
        )
        if sw1 != 0x61 or sw2 != length:
            raise RfproCardError(f"photo piece not served (SW {sw1:02x} {sw2:02x})")
        data, sw1, sw2 = self.connection.transmit(self.req_prefix + [length])
        data = self._restore_leading_ins(offset, length, data)
        if (sw1, sw2) != (0x90, 0x00) or len(data) != length:
            raise RfproCardError(
                f"short photo piece ({len(data)} of {length} bytes, SW {sw1:02x} {sw2:02x})"
            )
        return data

    def _fall_back_to_single_report(self, error: Exception) -> bool:
        """Paged replies are what lets a piece exceed one report. If one fails, read in
        report-sized pieces from now on (the way kiosk3 always worked) instead of failing the
        card. False when that is already the case."""
        if self.piece_size <= self._single_report_piece:
            return False
        logger.warning(
            "Long card replies failed (%s); reading in %d-byte pieces from now on",
            error,
            self._single_report_piece,
        )
        self.piece_size = self._single_report_piece
        return True

    def transmit_cmd(self, cmd: list[int]) -> list[int]:
        try:
            return self._transmit_cmd(cmd)
        except ReaderLostError:
            raise
        except RfproError as error:
            if not self._fall_back_to_single_report(error):
                raise
            return self._transmit_cmd(cmd)

    def _transmit_cmd(self, cmd: list[int]) -> list[int]:
        """Same as the PC/SC reader, but a field longer than one piece is read in pieces."""
        if len(cmd) != 7 or cmd[:2] != [0x80, 0xB0]:
            return super().transmit_cmd(cmd)
        # Every READ BINARY goes through _read_piece, even a field that fits one piece: it puts
        # back a leading C0 the module swallows (e.g. a name or address starting with "ภ").
        offset = (cmd[2] << 8) | cmd[3]
        data: list[int] = []
        for start in range(0, cmd[-1], self.piece_size):
            piece = self._read_piece(offset + start, min(self.piece_size, cmd[-1] - start))
            if piece is None:  # the PC/SC path also takes what the card gave, whatever its SW
                break
            data.extend(piece)
        return data

    def get_photo_bytes(self) -> bytes | None:
        """The 20 photo chunks, each read in pieces; a photo that takes longer than
        PHOTO_BUDGET_SEC is dropped. A piece the module rejects, or that comes back short, is
        retried after resetting the card, so one bad exchange in the ~260 pieces does not cost
        the whole photo. A gap would shift every later byte of the JPEG (kiosk3 stored a
        5078-byte photo, 22 bytes short, with most of the face blank), so a photo that cannot
        be read whole is dropped rather than kept damaged."""
        deadline = time.monotonic() + PHOTO_BUDGET_SEC
        recoveries = 0
        data: list[int] = []
        for cmd in CMD_PHOTOS:
            offset = (cmd[2] << 8) | cmd[3]
            for start in range(0, cmd[-1], self.piece_size):
                while True:
                    if time.monotonic() > deadline:
                        logger.warning(
                            "Card photo skipped: not read within %.0fs", PHOTO_BUDGET_SEC
                        )
                        return None
                    try:
                        piece = self._read_photo_piece(
                            offset + start, min(self.piece_size, cmd[-1] - start)
                        )
                        break
                    except ReaderLostError:
                        raise
                    except RfproError as error:
                        if self._fall_back_to_single_report(error):
                            # Start over: changing the piece size half way would leave a gap
                            # that shifts every later byte of the JPEG.
                            self.connection.power_cycle()
                            if not self.connect():
                                logger.error("Card photo could not be read: card did not answer reset")
                                return None
                            return self.get_photo_bytes()
                        if recoveries >= MAX_PHOTO_RECOVERIES:
                            logger.error("Card photo could not be read: %s", error)
                            return None
                        recoveries += 1
                        logger.warning(
                            "Card photo piece failed (%s); resetting the card and retrying (%d/%d)",
                            error,
                            recoveries,
                            MAX_PHOTO_RECOVERIES,
                        )
                        # Cold reset, then connect() resets and re-selects the applet.
                        self.connection.power_cycle()
                        if not self.connect():
                            logger.error("Card photo could not be read: card did not answer reset")
                            return None
                data.extend(piece)
            self._report("photo", CMD_PHOTOS.index(cmd) + 1, len(CMD_PHOTOS))
        return bytes(data)

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
