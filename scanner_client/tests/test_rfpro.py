import asyncio
import base64
import logging
import socket
import threading
import unittest
from unittest.mock import patch

from app import manager, rfpro
from app.rfpro import (
    CMD_HW_VER,
    CMD_ICC_APDU,
    CMD_ICC_GETATR,
    CMD_ICC_SEL,
    CMD_ICC_SLOT_PWR,
    CMD_NEXT_REPORT,
    CMD_ICC_ST,
    Reply,
    RfproCardError,
    RfproConnection,
    RfproDeviceLostError,
    RfproProtocolError,
    RfproThaiCardReader,
    RfproTransport,
    build_frame,
    parse_frame,
)
from app.scard import CMD_ADDRESS, CMD_CID, CMD_PHOTOS, CMD_THFULLNAME, THAI_CARD_AID
from tests.test_manager import FakePage, valid_config

OUT_SIZE = 32
HEARTBEAT = b"\xff\xff"
ATR_3B79 = bytes.fromhex(
    "3b7996000054480000"
)  # "TH NID"-style ATR, GET RESPONSE P2 = 00
ATR_3B67 = bytes.fromhex("3b67000000")  # older cards: GET RESPONSE P2 = 01
CID = "3101234567891"


def reply_frame(inx: int, cmd: bytes, status: int, data: bytes = b"") -> bytes:
    body = (
        bytes([inx])
        + (5 + len(data)).to_bytes(2, "big")
        + b"\x00\x00"
        + cmd
        + bytes([status])
        + data
    )
    checksum = 0
    for byte in body:
        checksum ^= byte
    return b"\xaa" + body + bytes([checksum])


def reports(frame: bytes, size: int = OUT_SIZE):
    return [
        frame[i : i + size].ljust(size, b"\x00") for i in range(0, len(frame), size)
    ]


class FakeHidDevice:
    """The device end of a SOCK_SEQPACKET pair: one datagram = one HID report."""

    def __init__(
        self,
        handler=None,
        *,
        heartbeats=False,
        raw=None,
        report_id=None,
        size=OUT_SIZE,
        single_report=False,
        paged=False,
    ):
        """`raw(inx, cmd, data)` returns the exact reports to send (for malformed-traffic tests);
        `report_id` prefixes every reply report, like a hidraw node with numbered reports."""
        self.client, self.peer = socket.socketpair(
            socket.AF_UNIX, socket.SOCK_SEQPACKET
        )
        self.handler = handler
        self.heartbeats = heartbeats
        self.raw = raw
        self.report_id = report_id
        self.size = size
        # kiosk3 behaviour: of a reply longer than one input report only the first arrives.
        self.single_report = single_report
        # What the vendor library revealed: the rest of a long reply is released one report at
        # a time by `FE FF` requests.
        self.paged = paged
        self.pending: list[bytes] = []
        self.commands: list[tuple[bytes, bytes]] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def transport(self, timeout=1.0) -> RfproTransport:
        return RfproTransport(
            self.client.detach(),
            report_id=self.report_id or 0,
            out_size=self.size,
            has_report_ids=self.report_id is not None,
            timeout=timeout,
        )

    def _serve(self):
        self.peer.settimeout(0.05)
        while not self._stop.is_set():
            try:
                report = self.peer.recv(512)
            except TimeoutError:
                continue
            except OSError:
                return
            if not report:
                return
            frame = report[1:]  # drop the report id
            length = int.from_bytes(frame[2:4], "big")
            inx, cmd, data = frame[1], frame[6:8], frame[8 : 4 + length]
            self.commands.append((cmd, data))
            if self.paged and cmd == CMD_NEXT_REPORT:
                try:
                    if self.pending:
                        self._send(self.pending.pop(0))
                except OSError:
                    return
                continue
            try:
                if self.raw is not None:
                    for chunk in self.raw(inx, cmd, data):
                        self._send(chunk)
                    continue
                answer = self.handler(cmd, data)
                if answer is None:
                    continue  # simulate a device that never answers
                status, payload = answer
                if self.heartbeats:
                    self._send(reports(reply_frame(0, HEARTBEAT, 0), self.size)[0])
                chunks = reports(reply_frame(inx, cmd, status, payload), self.size)
                if self.paged:
                    self.pending = chunks[1:]
                    chunks = chunks[:1]
                for chunk in chunks[:1] if self.single_report else chunks:
                    self._send(chunk)
            except OSError:
                return

    def _send(self, report: bytes) -> None:
        prefix = b"" if self.report_id is None else bytes([self.report_id])
        self.peer.send(prefix + report)

    def close(self):
        self._stop.set()
        self._thread.join(timeout=1)
        self.peer.close()


class FakeThaiCard:
    """Answers the module's commands and the Thai ID applet's APDUs."""

    def __init__(
        self, atr=ATR_3B79, present=True, atr_failures=0, atr_silences=0, drops_leading_ins=False
    ):
        self.atr = atr
        # kiosk3's module swallows a first data byte equal to GET RESPONSE's INS (C0).
        self.drops_leading_ins = drops_leading_ins
        self.present = present
        self.atr_failures = atr_failures
        self.atr_silences = atr_silences
        self.pending = b""
        self.get_response_p2: list[int] = []
        self.photo = (bytes(range(256)) * 20)[:5100]  # 20 chunks of 255, like a real card
        self.fields = {
            tuple(CMD_CID): CID.encode(),
            tuple(CMD_THFULLNAME): "นาย#สมชาย##ใจดี".encode("tis-620"),
        }
        for index, apdu in enumerate(CMD_PHOTOS):
            self.fields[tuple(apdu)] = self.photo[index * 255 : (index + 1) * 255]
        # Piecewise reads (offset, length) are served from this image; unstored space is blank.
        self.memory = bytearray(b" " * 0x1600)
        for apdu, field in self.fields.items():
            offset = (apdu[2] << 8) | apdu[3]
            self.memory[offset : offset + len(field)] = field

    def __call__(self, cmd, data):
        if cmd == CMD_HW_VER:
            return 0x00, b"C2-CEU-PRO V1.15.31.c"
        if cmd == CMD_ICC_ST:
            return 0x00, bytes([0x01 if self.present else 0x00])
        if cmd == CMD_ICC_SEL:
            return 0x00, b""
        if cmd == CMD_ICC_SLOT_PWR:
            return 0x00, b""
        if cmd == CMD_ICC_GETATR:
            if not self.present:
                return 0x20, b""
            if self.atr_silences:
                self.atr_silences -= 1
                return None  # the module never answers this reset
            if self.atr_failures:
                self.atr_failures -= 1
                return 0x11, b""
            return 0x00, self.atr
        if cmd == CMD_ICC_APDU:
            return 0x00, self._apdu(list(data[1:]))
        return 0x03, b""

    def _apdu(self, apdu):
        if apdu[:2] == [0x00, 0xA4]:  # SELECT
            assert apdu[5:] == THAI_CARD_AID
            return b"\x90\x00"
        if apdu[:2] == [0x00, 0xC0]:  # GET RESPONSE
            self.get_response_p2.append(apdu[3])
            data = self.pending
            if self.drops_leading_ins and data[:1] == b"\xc0":
                data = data[1:]
            return data + b"\x90\x00"
        field = self.fields.get(tuple(apdu))
        if field is None and apdu[:2] == [0x80, 0xB0]:
            offset = (apdu[2] << 8) | apdu[3]
            field = bytes(self.memory[offset : offset + apdu[-1]]) or None
        if field is None:
            self.pending = b""
            return b"\x6a\x82"
        self.pending = field
        return bytes([0x61, len(field)])


class FlakyPhotoCard(FakeThaiCard):
    """Rejects the first piece of photo chunk 5 at module level, like kiosk3's status 0x44."""

    FAILING_OFFSET = (CMD_PHOTOS[4][2] << 8) | CMD_PHOTOS[4][3]

    def __init__(self, failures: int, **kwargs):
        super().__init__(**kwargs)
        self.failures = failures

    def __call__(self, cmd, data):
        apdu = list(data[1:])
        if (
            cmd == CMD_ICC_APDU
            and self.failures
            and apdu[:2] == [0x80, 0xB0]
            and ((apdu[2] << 8) | apdu[3]) == self.FAILING_OFFSET
        ):
            self.failures -= 1
            return 0x44, b""
        return super().__call__(cmd, data)


class ShortPhotoPieceCard(FakeThaiCard):
    """Serves the first piece of photo chunk 5 two bytes short, like the 5078-byte photo kiosk3
    stored after a retry."""

    def __init__(self, failures: int, **kwargs):
        super().__init__(**kwargs)
        self.failures = failures

    def _apdu(self, apdu):
        answer = super()._apdu(apdu)
        offset = (apdu[2] << 8) | apdu[3] if apdu[:2] == [0x80, 0xB0] else None
        if self.failures and offset == FlakyPhotoCard.FAILING_OFFSET:
            self.failures -= 1
            self.pending = self.pending[:-2]
        return answer


class FrameTests(unittest.TestCase):
    def test_requests_match_the_vendor_document_examples(self):
        cases = {
            "18 00 card state": (
                0xBB,
                CMD_ICC_ST,
                b"\x00",
                "AA BB 00 05 00 00 18 00 00 A6",
            ),
            "18 01 select type": (
                0xBB,
                CMD_ICC_SEL,
                b"\x00\x0c",
                "AA BB 00 06 00 00 18 01 00 0C A8",
            ),
            "18 81 APDU": (
                0x00,
                CMD_ICC_APDU,
                b"\x00" + bytes.fromhex("0084000008"),
                "AA 00 00 0A 00 00 18 81 00 00 84 00 00 08 1F",
            ),
        }
        for name, (inx, cmd, data, expected) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(build_frame(inx, cmd, data), bytes.fromhex(expected))

    def test_parses_the_vendor_apdu_reply_example(self):
        raw = bytes.fromhex(
            "AA 00 00 0F 00 00 18 81 00 20 C9 24 32 20 36 81 7F 90 00 11"
        )

        reply = parse_frame(raw)

        self.assertEqual(
            reply, Reply(inx=0, cmd=CMD_ICC_APDU, status=0, data=raw[9:-1])
        )
        self.assertEqual(reply.data[-2:], b"\x90\x00")

    def test_incomplete_frames_wait_and_bad_checksums_raise(self):
        raw = reply_frame(1, CMD_ICC_ST, 0, b"\x01")

        self.assertIsNone(parse_frame(raw[:6]))
        with self.assertRaises(RfproProtocolError):
            parse_frame(raw[:-1] + bytes([raw[-1] ^ 0xFF]))

    def test_next_report_request_matches_what_the_vendor_library_sends(self):
        # usbmon: aa 06 00 04 00 00 fe ff (+ checksum) after the first report of a long reply.
        frame = build_frame(6, CMD_NEXT_REPORT)
        self.assertEqual(frame.hex(" "), "aa 06 00 04 00 00 fe ff 03")

    def test_full_read_report_splits_the_time_and_counts_the_page_requests(self):
        import contextlib
        import io

        import inspect_card_rfpro

        card = FakeThaiCard()
        device = FakeHidDevice(card, paged=True)
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)
        out = io.StringIO()

        with patch.object(rfpro, "POWER_CYCLE_SETTLE_SEC", 0), contextlib.redirect_stdout(out):
            inspect_card_rfpro.read_full(transport)

        text = out.getvalue()
        self.assertIn("แยกเวลา: ตัดไฟ/รีเซ็ตบัตร", text)
        self.assertRegex(text, r"ขอหน้าถัดไป FE FF [1-9]\d*\)")
        self.assertIn("piece_size 255", text)
        self.assertIn("✅ อ่านครบทั้งใบ", text)

    def test_paged_reply_reads_every_size_and_reports_pages(self):
        import contextlib
        import io

        import inspect_card_rfpro

        card = FakeThaiCard()
        device = FakeHidDevice(card, paged=True)
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)
        out = io.StringIO()

        with patch.object(rfpro, "POWER_CYCLE_SETTLE_SEC", 0), contextlib.redirect_stdout(out):
            inspect_card_rfpro.paged_reply(transport)

        text = out.getvalue()
        self.assertIn("✅ Le  20: 1 หน้า", text)
        self.assertIn("✅ Le  48: 2 หน้า", text)  # 60-byte frame = 32 + 28
        self.assertIn("✅ Le 255: 9 หน้า", text)  # 267-byte frame
        self.assertNotIn("❌", text)
        self.assertIn(CMD_NEXT_REPORT, [cmd for cmd, _ in device.commands])

    def test_paged_reply_fails_cleanly_when_the_module_does_not_know_fe_ff(self):
        import contextlib
        import io

        import inspect_card_rfpro

        card = FakeThaiCard()
        device = FakeHidDevice(card, single_report=True)  # a module without FE FF answers it as unknown
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)
        out = io.StringIO()

        with (
            patch.object(rfpro, "POWER_CYCLE_SETTLE_SEC", 0),
            patch.object(inspect_card_rfpro, "PAGED_LADDER", (48,)),
            contextlib.redirect_stdout(out),
        ):
            inspect_card_rfpro.paged_reply(transport)

        self.assertIn("❌ Le  48: module does not support FE FF", out.getvalue())

    def test_commands_outside_the_allowlist_never_reach_the_wire(self):
        # 00 01 reboot, 00 04 write flash, 00 07 change baud (vendor command table).
        for cmd in (b"\x00\x01", b"\x00\x04", b"\x00\x07", b"\x18\x82"):
            with self.subTest(cmd=cmd.hex()), self.assertRaises(ValueError):
                build_frame(1, cmd)

        device = FakeHidDevice(lambda *_: (0, b""))
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)
        with self.assertRaises(ValueError):
            transport.command(b"\x00\x01")
        self.assertEqual(device.commands, [])


class TransportTests(unittest.TestCase):
    def test_skips_heartbeats_and_joins_replies_that_span_reports(self):
        payload = bytes(range(150))
        device = FakeHidDevice(lambda cmd, data: (0, payload), heartbeats=True, paged=True)
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)

        reply = transport.command(CMD_ICC_APDU, b"\x00\x00")

        self.assertEqual(reply.cmd, CMD_ICC_APDU)
        self.assertEqual(reply.data, payload)

    def test_unanswered_command_times_out(self):
        device = FakeHidDevice(lambda *_: None)
        self.addCleanup(device.close)
        transport = device.transport(timeout=0.2)
        self.addCleanup(transport.close)

        with self.assertRaises(RfproProtocolError):
            transport.command(CMD_HW_VER)

    def test_heartbeat_between_the_reports_of_one_reply_is_skipped(self):
        payload = bytes(range(100))

        def raw(inx, cmd, data):
            first, *rest = reports(reply_frame(inx, cmd, 0, payload))
            return [first, *reports(reply_frame(0, HEARTBEAT, 0)), *rest]

        device = FakeHidDevice(raw=raw)
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)

        self.assertEqual(transport.command(CMD_ICC_APDU, b"\x00\x00").data, payload)

    def test_continuation_report_that_starts_with_stx_is_not_mistaken_for_a_heartbeat(
        self,
    ):
        payload = bytearray(range(100))
        payload[23] = 0xAA  # frame byte 32 = first byte of the 2nd report
        device = FakeHidDevice(lambda cmd, data: (0, bytes(payload)))
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)

        self.assertEqual(
            transport.command(CMD_ICC_APDU, b"\x00\x00").data, bytes(payload)
        )

    def test_a_late_reply_with_an_older_inx_is_ignored(self):
        def raw(inx, cmd, data):
            stale = reply_frame((inx - 1) % 256 or 255, cmd, 0, b"stale")
            return [*reports(stale), *reports(reply_frame(inx, cmd, 0, b"fresh"))]

        device = FakeHidDevice(raw=raw)
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)

        self.assertEqual(transport.command(CMD_ICC_APDU, b"\x00\x00").data, b"fresh")

    def test_corrupt_frames_are_skipped_instead_of_failing_the_command(self):
        def raw(inx, cmd, data):
            bad_checksum = bytearray(reply_frame(inx, cmd, 0, b"junk"))
            bad_checksum[-1] ^= 0xFF
            bad_length = b"\xaa" + bytes(31)  # STX then LEN = 0
            good = reply_frame(inx, cmd, 0, b"good")
            return [*reports(bytes(bad_checksum)), bad_length, *reports(good)]

        device = FakeHidDevice(raw=raw)
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)

        self.assertEqual(transport.command(CMD_ICC_APDU, b"\x00\x00").data, b"good")

    def test_numbered_reports_are_prefixed_on_write_and_stripped_on_read(self):
        payload = bytes(range(80))
        device = FakeHidDevice(lambda cmd, data: (0, payload), report_id=1, size=64, paged=True)
        self.addCleanup(device.close)
        transport = device.transport()
        self.addCleanup(transport.close)

        reply = transport.command(CMD_ICC_APDU, b"\x00\x00")

        self.assertEqual(reply.data, payload)
        self.assertEqual(device.commands, [(CMD_ICC_APDU, b"\x00\x00"), (CMD_NEXT_REPORT, b"")])

    def test_unplugged_device_raises_device_lost(self):
        device = FakeHidDevice(lambda *_: (0, b""))
        transport = device.transport()
        device.close()  # peer closes: reads return EOF / writes fail

        with self.assertRaises(RfproDeviceLostError):
            transport.command(CMD_HW_VER)
        with self.assertRaises(RfproDeviceLostError):  # and stays closed
            transport.command(CMD_HW_VER)


def make_reader(card: FakeThaiCard, **kwargs):
    # The real module releases a long reply one report per FE FF request; single_report=True is
    # a module that cannot (nothing after the first report), which makes the reader fall back.
    kwargs.setdefault("paged", not kwargs.get("single_report", False))
    device = FakeHidDevice(card, **kwargs)
    transport = device.transport()
    reader = RfproThaiCardReader(transport=transport)
    return device, reader


class ConnectionTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(rfpro, "POWER_CYCLE_SETTLE_SEC", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def connection(self, card, timeout=1.0):
        device = FakeHidDevice(card)
        self.addCleanup(device.close)
        transport = device.transport(timeout=timeout)
        self.addCleanup(transport.close)
        return device, RfproConnection(transport)

    def test_connect_selects_cpu_card_and_returns_the_atr(self):
        device, connection = self.connection(FakeThaiCard())

        connection.connect()

        self.assertEqual(bytes(connection.getATR()), ATR_3B79)
        self.assertEqual(
            [cmd for cmd, _ in device.commands], [CMD_ICC_SEL, CMD_ICC_GETATR]
        )
        self.assertEqual(device.commands[0][1], b"\x00\x0c")

    def test_atr_failure_power_cycles_once_then_succeeds(self):
        device, connection = self.connection(FakeThaiCard(atr_failures=1))

        connection.connect()

        self.assertEqual(
            device.commands[2:],
            [
                (CMD_ICC_SLOT_PWR, b"\x00\x00"),
                (CMD_ICC_SLOT_PWR, b"\x00\x01"),
                (CMD_ICC_GETATR, b"\x00"),
            ],
        )

    def test_unanswered_atr_request_power_cycles_once_then_succeeds(self):
        device, connection = self.connection(FakeThaiCard(atr_silences=1), timeout=0.2)

        connection.connect()

        self.assertEqual(bytes(connection.getATR()), ATR_3B79)
        self.assertEqual(
            device.commands[2:],
            [
                (CMD_ICC_SLOT_PWR, b"\x00\x00"),
                (CMD_ICC_SLOT_PWR, b"\x00\x01"),
                (CMD_ICC_GETATR, b"\x00"),
            ],
        )

    def test_atr_request_unanswered_even_after_the_power_cycle_raises(self):
        _, connection = self.connection(FakeThaiCard(atr_silences=2), timeout=0.2)

        with self.assertRaises(RfproProtocolError):
            connection.connect()

    def test_two_atr_failures_raise(self):
        _, connection = self.connection(FakeThaiCard(atr_failures=2))

        with self.assertRaises(RfproCardError):
            connection.connect()

    def test_transmit_splits_data_and_status_words(self):
        _, connection = self.connection(FakeThaiCard())

        data, sw1, sw2 = connection.transmit(list(CMD_CID))

        self.assertEqual((data, sw1, sw2), ([], 0x61, 13))


class ReaderTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(rfpro, "POWER_CYCLE_SETTLE_SEC", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def reader(self, card=None, **kwargs):
        card = card or FakeThaiCard()
        device, reader = make_reader(card, **kwargs)
        self.addCleanup(device.close)
        self.addCleanup(reader.close)
        return card, device, reader

    def test_poll_reports_card_state_without_resetting_the_card(self):
        card, device, reader = self.reader()
        device.commands.clear()

        self.assertTrue(reader.is_card_inserted())
        card.present = False
        self.assertFalse(reader.is_card_inserted())

        self.assertEqual([cmd for cmd, _ in device.commands], [CMD_ICC_ST, CMD_ICC_ST])

    def test_read_citizen_id_returns_the_13_digit_number(self):
        _, _, reader = self.reader()

        self.assertEqual(reader.read_citizen_id(), CID)

    def test_get_response_p2_follows_the_atr(self):
        for atr, expected_p2 in ((ATR_3B79, 0x00), (ATR_3B67, 0x01)):
            with self.subTest(atr=atr.hex()):
                card, _, reader = self.reader(FakeThaiCard(atr=atr))
                reader.read_citizen_id()
                self.assertEqual(card.get_response_p2, [expected_p2])

    def test_read_all_data_returns_every_field_and_the_full_photo(self):
        card, _, reader = self.reader(heartbeats=True)
        # Fields this fake card does not store answer 6A 82 -> empty strings, like a blank record.
        data = reader.read_all_data()

        self.assertEqual(data["citizen_id"], CID)
        self.assertEqual(data["first_name_th"], "สมชาย")
        self.assertEqual(data["last_name_th"], "ใจดี")
        photo = data["photo_base64"]
        self.assertTrue(photo.startswith("data:image/jpeg;base64,"))
        # The last chunk is short; the piece reads that run past it return blank card space.
        self.assertTrue(base64.b64decode(photo.split(",", 1)[1]).startswith(card.photo))

    def test_read_all_data_starts_from_a_cold_power_up_like_a_reinserted_card(self):
        # kiosk3: a card left in since the ID read only read in full after a re-insert.
        _, device, reader = self.reader()
        reader.read_citizen_id()
        device.commands.clear()

        reader.read_all_data()

        self.assertEqual(
            device.commands[:4],
            [
                (CMD_ICC_SLOT_PWR, b"\x00\x00"),
                (CMD_ICC_SLOT_PWR, b"\x00\x01"),
                (CMD_ICC_SEL, b"\x00\x0c"),
                (CMD_ICC_GETATR, b"\x00"),
            ],
        )

    def test_read_all_data_survives_a_module_that_returns_one_report_per_reply(self):
        # kiosk3: a 100-byte answer is a 112-byte frame, and only its first 32 bytes arrive.
        card, device, reader = self.reader(single_report=True)

        data = reader.read_all_data()

        self.assertEqual(data["citizen_id"], CID)
        self.assertEqual(data["full_name_th"], "นาย สมชาย ใจดี")
        self.assertTrue(base64.b64decode(data["photo_base64"].split(",", 1)[1]).startswith(card.photo))
        # The paged attempt failed, so the reader dropped to report-sized pieces for good.
        self.assertEqual(reader.piece_size, 20)

    def test_fields_that_fit_one_report_are_read_in_a_single_command(self):
        _, device, reader = self.reader(single_report=True)
        device.commands.clear()

        reader.transmit_cmd(list(CMD_CID))

        self.assertEqual(len([1 for c, _ in device.commands if c == CMD_ICC_APDU]), 2)

    def test_pieces_are_a_whole_card_field_and_fall_back_to_what_one_report_holds(self):
        _, _, reader = self.reader()
        self.assertEqual(reader.piece_size, 255)  # paged replies: a whole field in one exchange
        self.assertEqual(reader._single_report_piece, 20)  # 32-byte report - 12 bytes of frame and SW

    def test_the_photo_is_read_in_about_forty_commands_not_five_hundred(self):
        card, device, reader = self.reader()
        reader.connect()
        device.commands.clear()

        photo = reader.get_photo_bytes()

        self.assertEqual(photo, card.photo)
        photo_apdus = [c for c, _ in device.commands if c == CMD_ICC_APDU]
        self.assertEqual(len(photo_apdus), 40)  # READ BINARY + GET RESPONSE for 20 chunks of 255
        self.assertIn(CMD_NEXT_REPORT, [c for c, _ in device.commands])  # replies were paged

    def test_photo_is_dropped_when_it_takes_longer_than_the_budget(self):
        _, _, reader = self.reader()

        with patch.object(rfpro, "PHOTO_BUDGET_SEC", -1), self.assertLogs(
            rfpro.logger, level="WARNING"
        ):
            self.assertIsNone(reader.get_photo_bytes())

    def test_a_photo_piece_the_module_rejects_is_retried_after_a_card_reset(self):
        # kiosk3: one photo piece answered status 0x44 and the whole photo was dropped.
        card, device, reader = self.reader(FlakyPhotoCard(failures=1))
        reader.connect()
        device.commands.clear()

        with self.assertLogs(rfpro.logger, level="WARNING"):
            photo = reader.get_photo_bytes()

        self.assertIsNotNone(photo)
        self.assertTrue(photo.startswith(card.photo))
        self.assertEqual(card.failures, 0)
        self.assertIn(CMD_ICC_GETATR, [cmd for cmd, _ in device.commands])  # the card was reset

    def test_a_photo_piece_starting_with_c0_is_restored_on_a_module_that_drops_it(self):
        # The fake photo has a piece that starts with C0 (chunk 8, piece 10); without the fix
        # that piece came back 19 of 20 bytes, every time.
        card, _, reader = self.reader(FakeThaiCard(drops_leading_ins=True))
        reader.connect()

        photo = reader.get_photo_bytes()

        self.assertIsNotNone(photo)
        self.assertEqual(len(photo), 20 * 255)
        self.assertTrue(photo.startswith(card.photo))

    def test_a_text_field_keeps_a_tho_phu_that_starts_a_piece(self):
        # C0 is "ภ" in TIS-620: an address with ภ right at a 20-byte piece boundary lost it.
        card = FakeThaiCard(drops_leading_ins=True)
        address = ("1#" + "x" * 18 + "ภูเก็ต").encode("tis-620")
        offset = (CMD_ADDRESS[2] << 8) | CMD_ADDRESS[3]
        card.memory[offset : offset + len(address)] = address
        _, _, reader = self.reader(card)
        reader.connect()

        self.assertIn("ภูเก็ต", reader.decode_tis620(reader.transmit_cmd(list(CMD_ADDRESS))))

    def test_a_short_photo_piece_is_read_again_instead_of_leaving_a_gap(self):
        card, _, reader = self.reader(ShortPhotoPieceCard(failures=1))
        reader.connect()

        with self.assertLogs(rfpro.logger, level="WARNING"):
            photo = reader.get_photo_bytes()

        self.assertEqual(len(photo), 20 * 255)
        self.assertTrue(photo.startswith(card.photo))
        self.assertEqual(card.failures, 0)

    def test_photo_that_keeps_coming_back_short_is_dropped_not_stored_damaged(self):
        _, _, reader = self.reader(ShortPhotoPieceCard(failures=99))
        reader.connect()

        with self.assertLogs(rfpro.logger, level="ERROR"):
            self.assertIsNone(reader.get_photo_bytes())

    def test_photo_is_dropped_when_the_module_keeps_rejecting_a_piece(self):
        card, _, reader = self.reader(FlakyPhotoCard(failures=99))
        reader.piece_size = reader._single_report_piece  # the retry limit is about report-sized pieces
        reader.connect()

        with self.assertLogs(rfpro.logger, level="ERROR"):
            self.assertIsNone(reader.get_photo_bytes())
        self.assertEqual(card.failures, 99 - rfpro.MAX_PHOTO_RECOVERIES - 1)

    def test_a_failure_with_whole_field_pieces_restarts_the_photo_with_report_sized_ones(self):
        card, _, reader = self.reader(FlakyPhotoCard(failures=1))
        reader.connect()

        with self.assertLogs(rfpro.logger, level="WARNING") as logs:
            photo = reader.get_photo_bytes()

        self.assertEqual(photo, card.photo)  # whole and in order: no gap from the switch
        self.assertEqual(reader.piece_size, 20)
        self.assertTrue(any("reading in 20-byte pieces" in line for line in logs.output))

    def test_unplugging_during_a_read_surfaces_as_a_lost_reader_not_a_card_error(self):
        from app.scard import ReaderLostError

        _, device, reader = self.reader()
        device.peer.close()  # USB pulled between the poll and the read

        for read in (reader.read_citizen_id, reader.read_all_data):
            with self.subTest(read=read.__name__), self.assertRaises(ReaderLostError):
                read()

    def test_missing_card_raises_instead_of_hanging(self):
        _, _, reader = self.reader(FakeThaiCard(present=False))

        with self.assertRaises(RuntimeError):
            reader.read_citizen_id()

    def test_unanswered_polls_eventually_report_the_reader_as_lost(self):
        device = FakeHidDevice(
            lambda cmd, data: (0, b"fw") if cmd == CMD_HW_VER else None
        )
        self.addCleanup(device.close)
        reader = RfproThaiCardReader(transport=device.transport(timeout=0.05))
        self.addCleanup(reader.close)

        results = []
        for _ in range(rfpro.MAX_POLL_FAILURES - 1):
            results.append(reader.is_card_inserted())
        with self.assertRaises(RfproDeviceLostError):
            reader.is_card_inserted()

        self.assertEqual(results, [False] * (rfpro.MAX_POLL_FAILURES - 1))

    def test_no_card_data_reaches_the_logs(self):
        with self.assertLogs(level=logging.DEBUG) as logs:
            _, _, reader = self.reader()
            reader.is_card_inserted()
            reader.read_all_data()

        text = "\n".join(logs.output)
        for secret in (CID, "สมชาย", "ใจดี"):
            self.assertNotIn(secret, text)
        self.assertIn("C2-CEU-PRO V1.15.31.c", text)  # firmware version is logged (R8)


class ManagerWiringTests(unittest.IsolatedAsyncioTestCase):
    def test_rfpro_setting_selects_the_hid_reader(self):
        client = manager.ScannerClientManager(
            valid_config(CARD_READER="rfpro", CARD_READER_USB_ID="0483:4c43")
        )
        with patch.object(manager, "RfproThaiCardReader") as rfpro_reader:
            created = client._create_reader()

        rfpro_reader.assert_called_once_with("0483:4c43")
        self.assertIs(created, rfpro_reader.return_value)

    def test_default_setting_keeps_the_pcsc_reader(self):
        client = manager.ScannerClientManager(valid_config())
        with (
            patch.object(manager, "ThaiSmartCardReader") as pcsc_reader,
            patch.object(manager, "RfproThaiCardReader") as rfpro_reader,
        ):
            created = client._create_reader()

        pcsc_reader.assert_called_once_with()
        rfpro_reader.assert_not_called()
        self.assertIs(created, pcsc_reader.return_value)

    async def test_init_reader_names_the_reader_type_it_is_waiting_for(self):
        client = manager.ScannerClientManager(valid_config(CARD_READER="rfpro"))

        def not_plugged_in():
            client.running = False
            raise RfproDeviceLostError("card reader 0483:4c43 not found")

        async def no_sleep(_seconds):
            return None

        with (
            patch.object(client, "_create_reader", new=not_plugged_in),
            patch.object(asyncio, "sleep", new=no_sleep),
            self.assertLogs(manager.logger, level="WARNING") as logs,
        ):
            self.assertFalse(await client.init_reader())

        self.assertTrue(
            any("rfpro" in line and "not found" in line for line in logs.output)
        )

    async def test_unplugged_reader_is_dropped_and_waited_for_again(self):
        client = manager.ScannerClientManager(valid_config(CARD_READER="rfpro"))
        client.page = FakePage(client.home_url)
        closed = []

        class UnpluggedReader:
            def is_card_inserted(self):
                raise RfproDeviceLostError("gone")

            def close(self):
                closed.append(True)

        init_calls = []

        async def fake_init_reader():
            init_calls.append(True)
            if len(init_calls) == 1:
                client.reader = UnpluggedReader()
            else:
                client.running = False
            return True

        async def no_sleep(_seconds):
            return None

        with (
            patch.object(client, "init_reader", new=fake_init_reader),
            patch.object(asyncio, "sleep", new=no_sleep),
            self.assertLogs(manager.logger, level="WARNING") as logs,
        ):
            await client.card_reading_loop()

        self.assertEqual(closed, [True])
        self.assertEqual(len(init_calls), 2)
        self.assertIsNone(client.reader)
        self.assertTrue(any("disconnected" in line for line in logs.output))


if __name__ == "__main__":
    unittest.main()
