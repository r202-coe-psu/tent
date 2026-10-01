"""
ทดสอบอ่านบัตรประชาชนผ่านเครื่องอ่าน HID ของตู้ kiosk3 (RFpro/comPro protocol) — stdlib only, ต้องรันด้วย sudo

Manual hardware inspector for the HOUSESmart 0483:4c43 card reader (YE XIN EF-011C socket).
Implements the vendor frame format from the RFpro SDK `Protocol-doc/通用协议规则_v1.0.1.pdf` and the
contact-card commands from `接触式IC卡功能指令_v1.0.7.pdf`. Not an automated test; run directly.

Only a fixed allowlist of read-only commands is ever sent (no flash/baud/reboot commands exist here):
  00 00 hardware version · 18 00 card state · 18 01 select card type · 18 02 slot power
  18 80 reset card (ATR) · 18 81 APDU (SELECT Thai ID applet, read CID, GET RESPONSE only)

Usage:
  sudo python3 inspect_card_rfpro.py            # ทุกขั้น: version → สถานะบัตร → รอเสียบบัตร → ATR → อ่านเลขบัตร
  sudo python3 inspect_card_rfpro.py ping       # ขั้น 1–2 อย่างเดียว (ไม่ต้องมีบัตร)
  --verbose     แสดง report ดิบที่ส่ง/รับ
  --show-cid    แสดงเลขบัตรเต็ม (default ปิดบังกลางเลข)
"""

from __future__ import annotations

import argparse
import os
import select
import sys
import time
from dataclasses import dataclass

from inspect_card_hid import DEFAULT_ID, HidNode, find_nodes

STX = 0xAA
HEARTBEAT = b"\xff\xff"
SLOT_MAIN = 0x00
CARD_CPU_7816 = 0x0C

CMD_HW_VER = b"\x00\x00"
CMD_ICC_ST = b"\x18\x00"
CMD_ICC_SEL = b"\x18\x01"
CMD_ICC_SLOT_PWR = b"\x18\x02"
CMD_ICC_GETATR = b"\x18\x80"
CMD_ICC_APDU = b"\x18\x81"
ALLOWED_CMDS = {
    CMD_HW_VER,
    CMD_ICC_ST,
    CMD_ICC_SEL,
    CMD_ICC_SLOT_PWR,
    CMD_ICC_GETATR,
    CMD_ICC_APDU,
}

# Thai national ID applet — same APDUs as app/scard.py.
APDU_SELECT_THAI = bytes(
    [0x00, 0xA4, 0x04, 0x00, 0x08, 0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01]
)
APDU_CID = bytes([0x80, 0xB0, 0x00, 0x04, 0x02, 0x00, 0x0D])

STATUS_TEXT = {
    0x00: "สำเร็จ",
    0x03: "ไม่รู้จักคำสั่ง",
    0x06: "checksum ผิด",
    0x07: "พอร์ตไม่ว่าง",
    0x20: "ไม่พบบัตร",
    0x25: "รีเซ็ตบัตรไม่สำเร็จ",
    0x26: "หมดเวลา",
    0x2D: "บัตรตอบ error",
    0xDF: "อุปกรณ์ไม่ว่าง",
    0xEF: "คำสั่งล้มเหลว",
    0xFF: "ไม่รองรับคำสั่ง",
}


ATR_HINT = """
   เครื่องตรวจเจอบัตร (สวิตช์ในช่อง) แต่ชิปไม่ตอบ — ตรวจตามนี้:
   1. กลับด้านบัตร: ลองเสียบให้ด้านชิปหงาย/คว่ำ และเอาด้านชิปเข้าก่อน (ทุกแบบ)
   2. เสียบให้สุดช่อง · เช็ดหน้าสัมผัสชิปให้สะอาด
   3. ลองบัตรชิปใบอื่น (บัตรประชาชนใบอื่น / บัตร ATM แบบมีชิป) — ถ้าทุกใบไม่ผ่าน = ปัญหาที่ช่อง/โมดูล
   (status 0x11 ไม่มีในเอกสารผู้ขาย — ถ้าลองครบแล้วยังไม่ได้ ให้ถามผู้ขายพร้อมแนบ output นี้)"""


class ProtocolError(RuntimeError):
    pass


def xor(data: bytes) -> int:
    value = 0
    for byte in data:
        value ^= byte
    return value


def build_frame(inx: int, cmd: bytes, data: bytes = b"") -> bytes:
    """AA · INX · LEN(BE, DEVICE+CMD+DATA) · DEVICE 0000 · CMD · DATA · XOR(INX..DATA)."""
    if cmd not in ALLOWED_CMDS:
        raise ValueError(f"command {cmd.hex()} is not in the read-only allowlist")
    body = (
        bytes([inx & 0xFF])
        + (4 + len(data)).to_bytes(2, "big")
        + b"\x00\x00"
        + cmd
        + data
    )
    return bytes([STX]) + body + bytes([xor(body)])


@dataclass
class Reply:
    inx: int
    cmd: bytes
    status: int
    data: bytes


def parse_frame(buf: bytes) -> Reply | None:
    """Parse the reply frame at the start of `buf`; None while the frame is still incomplete."""
    if len(buf) < 5:
        return None
    total = int.from_bytes(buf[2:4], "big") + 5  # STX + INX + LEN(2) + LEN bytes + CHK
    if len(buf) < total:
        return None
    frame = buf[:total]
    if xor(frame[1:-1]) != frame[-1]:
        raise ProtocolError(f"checksum ผิด: {frame.hex(' ')}")
    return Reply(inx=frame[1], cmd=frame[6:8], status=frame[8], data=frame[9:-1])


class Reader:
    def __init__(self, node: HidNode, verbose: bool) -> None:
        self.node = node
        self.verbose = verbose
        # Output report id (0 when the descriptor declares none).
        self.report_id = next(
            (rid for kind, rid in node.reports if kind == "Output"), 0
        )
        self.out_size = node.output_bytes(self.report_id) or 64
        self.fd = os.open(node.dev, os.O_RDWR | os.O_NONBLOCK)
        self.inx = 0
        self.buf = b""

    def close(self) -> None:
        os.close(self.fd)

    def _write(self, frame: bytes) -> None:
        # hidraw: report id first (0 = device uses none), then one Output report padded to its size.
        for start in range(0, len(frame), self.out_size):
            chunk = frame[start : start + self.out_size]
            if self.verbose:
                print(f"    TX {chunk.hex(' ')}")
            report = bytes([self.report_id]) + chunk.ljust(self.out_size, b"\x00")
            os.write(self.fd, report)

    def _read_report(self, timeout: float) -> bytes | None:
        ready, _, _ = select.select([self.fd], [], [], timeout)
        if not ready:
            return None
        report = os.read(self.fd, 512)
        if self.node.has_report_ids:
            report = report[1:]
        if self.verbose:
            trimmed = report.rstrip(b"\x00")
            print(f"    RX {trimmed.hex(' ')}")
        return report

    def command(self, cmd: bytes, data: bytes = b"", timeout: float = 3.0) -> Reply:
        self.inx = (self.inx + 1) & 0xFF
        self.buf = b""
        self._write(build_frame(self.inx, cmd, data))
        deadline = time.monotonic() + timeout
        while (left := deadline - time.monotonic()) > 0:
            report = self._read_report(left)
            if report is None:
                break
            if not self.buf:
                # A frame starts at STX; anything else (padding, stray bytes) is dropped.
                start = report.find(bytes([STX]))
                if start < 0:
                    continue
                report = report[start:]
            self.buf += report
            reply = parse_frame(self.buf)
            if reply is None:
                continue  # frame spans more reports
            self.buf = b""
            if reply.cmd == HEARTBEAT or reply.cmd != cmd:
                continue
            return reply
        raise ProtocolError(f"ไม่มีคำตอบสำหรับคำสั่ง {cmd.hex(' ')} ภายใน {timeout:.0f} วิ")

    def apdu(self, apdu: bytes) -> tuple[bytes, int, int]:
        reply = self.command(CMD_ICC_APDU, bytes([SLOT_MAIN]) + apdu)
        if reply.status != 0x00 or len(reply.data) < 2:
            raise ProtocolError(f"APDU ล้มเหลว: status {status_text(reply.status)}")
        return reply.data[:-2], reply.data[-2], reply.data[-1]


def status_text(status: int) -> str:
    return f"0x{status:02x} ({STATUS_TEXT.get(status, 'ไม่ทราบ')})"


def mask_cid(cid: str) -> str:
    return cid if len(cid) != 13 else f"{cid[0]}-XXXX-XXXXX-{cid[10:12]}-{cid[12]}"


def step(title: str) -> None:
    print(f"\n━━━ {title} ━━━")


def ping(reader: Reader) -> None:
    step("1) ขอ version ของเครื่องอ่าน (00 00)")
    reply = reader.command(CMD_HW_VER)
    text = reply.data.decode("ascii", errors="replace")
    print(
        f"✅ status {status_text(reply.status)} · data {reply.data.hex(' ')} · '{text}'"
    )
    print("   → การห่อ frame ลง HID report ถูกต้อง")

    step("2) สถานะบัตรที่ช่องหลัก (18 00)")
    print(f"   {describe_card_state(reader)}")


def describe_card_state(reader: Reader) -> str:
    reply = reader.command(CMD_ICC_ST, bytes([SLOT_MAIN]))
    if reply.status != 0x00 or not reply.data:
        return f"status {status_text(reply.status)}"
    return "มีบัตร" if reply.data[0] & 0x01 else "ไม่มีบัตร"


def read_cid(reader: Reader, show_cid: bool) -> None:
    step("3) รอเสียบบัตรประชาชน (สูงสุด 30 วิ)")
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        reply = reader.command(CMD_ICC_ST, bytes([SLOT_MAIN]))
        if reply.status == 0x00 and reply.data and reply.data[0] & 0x01:
            print("✅ พบบัตร")
            break
        time.sleep(0.5)
    else:
        raise ProtocolError("ไม่พบบัตรภายใน 30 วิ")

    step("4) เลือกบัตร CPU ISO 7816 (18 01) + รีเซ็ตบัตร (18 80)")
    reply = reader.command(CMD_ICC_SEL, bytes([SLOT_MAIN, CARD_CPU_7816]))
    print(f"   select type: status {status_text(reply.status)}")
    reply = reader.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))
    if reply.status != 0x00:
        print(
            f"   ATR ครั้งแรก: status {status_text(reply.status)} → ตัดไฟ/จ่ายไฟบัตรใหม่ (18 02) แล้วลองอีกครั้ง"
        )
        for act in (0x00, 0x01):
            power = reader.command(CMD_ICC_SLOT_PWR, bytes([SLOT_MAIN, act]))
            print(
                f"   slot power {'on' if act else 'off'}: status {status_text(power.status)}"
            )
            time.sleep(0.3)
        reply = reader.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))
    if reply.status != 0x00:
        print(ATR_HINT)
        raise ProtocolError(f"ขอ ATR ไม่สำเร็จ: status {status_text(reply.status)}")
    atr = reply.data
    print(f"✅ ATR {atr.hex(' ')}")
    # Same rule as app/scard.py: ATR 3B 67 cards answer GET RESPONSE with P2 = 01.
    get_response = bytes([0x00, 0xC0, 0x00, 0x01 if atr[:2] == b"\x3b\x67" else 0x00])

    step("5) SELECT applet บัตรประชาชน + อ่านเลขบัตร (18 81)")
    _, sw1, sw2 = reader.apdu(APDU_SELECT_THAI)
    print(f"   SELECT → SW {sw1:02X} {sw2:02X}")
    if sw1 not in (0x90, 0x61):
        raise ProtocolError("บัตรไม่ใช่บัตรประชาชนไทย หรือ SELECT ไม่สำเร็จ")
    _, sw1, sw2 = reader.apdu(APDU_CID)
    data, sw1, sw2 = reader.apdu(get_response + bytes([APDU_CID[-1]]))
    print(f"   GET RESPONSE → SW {sw1:02X} {sw2:02X}")
    cid = data.decode("ascii", errors="replace").replace("\x00", "").strip()
    if len(cid) == 13 and cid.isdigit():
        print(f"✅ เลขบัตร: {cid if show_cid else mask_cid(cid)}")
    else:
        print(f"❌ ข้อมูลที่ได้ไม่ใช่เลข 13 หลัก: {data.hex(' ')}")

    step("6) ตัดไฟบัตร (18 02)")
    reply = reader.command(CMD_ICC_SLOT_PWR, bytes([SLOT_MAIN, 0x00]))
    print(f"   status {status_text(reply.status)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("command", nargs="?", default="all", choices=["all", "ping"])
    parser.add_argument(
        "--id", default=DEFAULT_ID, help=f"VID:PID (default {DEFAULT_ID})"
    )
    parser.add_argument("--verbose", action="store_true", help="แสดง report ดิบ")
    parser.add_argument("--show-cid", action="store_true", help="แสดงเลขบัตรเต็ม")
    args = parser.parse_args()

    if os.geteuid() != 0:
        sys.exit("❌ ต้องรันด้วย sudo (อ่าน/เขียน /dev/hidraw*)")
    nodes = [
        n for n in find_nodes(args.id) if any(kind == "Output" for kind, _ in n.reports)
    ]
    if not nodes:
        sys.exit(f"❌ ไม่พบ interface ที่รับคำสั่งของ {args.id} — เสียบ USB ของโมดูลแล้วลองใหม่")
    node = nodes[0]
    print(
        f"ใช้ {node.dev} (interface {node.interface}, Output {node.output_bytes(0) or '?'} bytes)"
    )

    reader = Reader(node, args.verbose)
    try:
        ping(reader)
        if args.command == "all":
            read_cid(reader, args.show_cid)
    except ProtocolError as error:
        print(f"\n❌ {error}")
        print("   ลองใหม่ด้วย --verbose แล้วส่งผลให้ทีม dev")
        sys.exit(1)
    finally:
        reader.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nยกเลิก")
