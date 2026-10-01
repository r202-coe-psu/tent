"""
ทดสอบอ่านบัตรประชาชนผ่านเครื่องอ่าน HID ของตู้ kiosk3 (RFpro/comPro protocol) — ต้องรันด้วย sudo

Manual hardware inspector for the HOUSESmart 0483:4c43 card reader (YE XIN EF-011C socket).
Uses the same driver as the kiosk (`app/rfpro.py`: frame codec, command allowlist, hidraw
transport), so a pass here means the kiosk driver works on this machine. Not an automated
test; run directly from scanner_client/.

Only the driver's read-only command allowlist is ever sent (no flash/baud/reboot commands):
  00 00 hardware version · 18 00 card state · 18 01 select card type · 18 02 slot power
  18 80 reset card (ATR) · 18 81 APDU (SELECT Thai ID applet, read CID, GET RESPONSE only)

Usage:
  sudo python3 inspect_card_rfpro.py            # ทุกขั้น: version → สถานะบัตร → รอเสียบบัตร → ATR → อ่านเลขบัตร
  sudo python3 inspect_card_rfpro.py ping       # ขั้น 1–2 อย่างเดียว (ไม่ต้องมีบัตร)
  sudo python3 inspect_card_rfpro.py --full     # S0-6: อ่านทั้งใบ แสดงเฉพาะความยาวแต่ละ field + เวลา (ไม่แสดงข้อมูล)
  --verbose     แสดงคำสั่ง/คำตอบ (ข้อมูลบัตรใน APDU reply ถูกปิด เว้นแต่ใส่ --show-cid)
  --show-cid    แสดงเลขบัตรเต็ม (default ปิดบังกลางเลข)
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from app.rfpro import (
    CARD_CPU_7816,
    CMD_HW_VER,
    CMD_ICC_APDU,
    CMD_ICC_GETATR,
    CMD_ICC_SEL,
    CMD_ICC_SLOT_PWR,
    CMD_ICC_ST,
    HEARTBEAT,
    SLOT_MAIN,
    RfproError,
    RfproThaiCardReader,
    RfproTransport,
)
from app.scard import SELECT, THAI_CARD_AID
from inspect_card_hid import DEFAULT_ID

APDU_SELECT_THAI = bytes(SELECT + THAI_CARD_AID)
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


class InspectError(RuntimeError):
    pass


def status_text(status: int) -> str:
    return f"0x{status:02x} ({STATUS_TEXT.get(status, 'ไม่ทราบ')})"


def mask_cid(cid: str) -> str:
    return cid if len(cid) != 13 else f"{cid[0]}-XXXX-XXXXX-{cid[10:12]}-{cid[12]}"


def step(title: str) -> None:
    print(f"\n━━━ {title} ━━━")


def make_tracer(reveal: bool):
    """--verbose output. Card data (APDU payloads) is personal data: redacted unless --show-cid."""

    def trace(direction: str, cmd: bytes, status: int | None, data: bytes) -> None:
        if cmd == HEARTBEAT:
            return
        if cmd == CMD_ICC_APDU and not reveal:
            shown = f"<APDU {len(data)} bytes ถูกปิด>"
            if direction == "RX" and len(data) >= 2:
                shown += f" SW {data[-2]:02X} {data[-1]:02X}"
        else:
            shown = data.hex(" ")
        suffix = "" if status is None else f" status={status:02x}"
        print(f"    {direction} cmd={cmd.hex(' ')}{suffix} data={shown}")

    return trace


def ping(transport: RfproTransport) -> None:
    step("1) ขอ version ของเครื่องอ่าน (00 00)")
    reply = transport.command(CMD_HW_VER)
    text = reply.data.decode("ascii", errors="replace")
    print(f"✅ status {status_text(reply.status)} · data {reply.data.hex(' ')} · '{text}'")
    print("   → การห่อ frame ลง HID report ถูกต้อง")

    step("2) สถานะบัตรที่ช่องหลัก (18 00)")
    print(f"   {describe_card_state(transport)}")


def describe_card_state(transport: RfproTransport) -> str:
    reply = transport.command(CMD_ICC_ST, bytes([SLOT_MAIN]))
    if reply.status != 0x00 or not reply.data:
        return f"status {status_text(reply.status)}"
    return "มีบัตร" if reply.data[0] & 0x01 else "ไม่มีบัตร"


def wait_for_card(transport: RfproTransport) -> None:
    step("3) รอเสียบบัตรประชาชน (สูงสุด 30 วิ)")
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        reply = transport.command(CMD_ICC_ST, bytes([SLOT_MAIN]))
        if reply.status == 0x00 and reply.data and reply.data[0] & 0x01:
            print("✅ พบบัตร")
            return
        time.sleep(0.5)
    raise InspectError("ไม่พบบัตรภายใน 30 วิ")


def read_cid(transport: RfproTransport, show_cid: bool) -> None:
    wait_for_card(transport)

    step("4) เลือกบัตร CPU ISO 7816 (18 01) + รีเซ็ตบัตร (18 80)")
    reply = transport.command(CMD_ICC_SEL, bytes([SLOT_MAIN, CARD_CPU_7816]))
    print(f"   select type: status {status_text(reply.status)}")
    reply = transport.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))
    if reply.status != 0x00:
        print(
            f"   ATR ครั้งแรก: status {status_text(reply.status)} → ตัดไฟ/จ่ายไฟบัตรใหม่ (18 02) แล้วลองอีกครั้ง"
        )
        for act in (0x00, 0x01):
            power = transport.command(CMD_ICC_SLOT_PWR, bytes([SLOT_MAIN, act]))
            print(f"   slot power {'on' if act else 'off'}: status {status_text(power.status)}")
            time.sleep(0.3)
        reply = transport.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))
    if reply.status != 0x00:
        print(ATR_HINT)
        raise InspectError(f"ขอ ATR ไม่สำเร็จ: status {status_text(reply.status)}")
    atr = reply.data
    print(f"✅ ATR {atr.hex(' ')}")
    # Same rule as app/scard.py: ATR 3B 67 cards answer GET RESPONSE with P2 = 01.
    get_response = bytes([0x00, 0xC0, 0x00, 0x01 if atr[:2] == b"\x3b\x67" else 0x00])

    def apdu(payload: bytes) -> tuple[bytes, int, int]:
        answer = transport.command(CMD_ICC_APDU, bytes([SLOT_MAIN]) + payload)
        if answer.status != 0x00 or len(answer.data) < 2:
            raise InspectError(f"APDU ล้มเหลว: status {status_text(answer.status)}")
        return answer.data[:-2], answer.data[-2], answer.data[-1]

    step("5) SELECT applet บัตรประชาชน + อ่านเลขบัตร (18 81)")
    _, sw1, sw2 = apdu(APDU_SELECT_THAI)
    print(f"   SELECT → SW {sw1:02X} {sw2:02X}")
    if sw1 not in (0x90, 0x61):
        raise InspectError("บัตรไม่ใช่บัตรประชาชนไทย หรือ SELECT ไม่สำเร็จ")
    apdu(APDU_CID)
    data, sw1, sw2 = apdu(get_response + bytes([APDU_CID[-1]]))
    print(f"   GET RESPONSE → SW {sw1:02X} {sw2:02X}")
    cid = data.decode("ascii", errors="replace").replace("\x00", "").strip()
    if len(cid) == 13 and cid.isdigit():
        print(f"✅ เลขบัตร: {cid if show_cid else mask_cid(cid)}")
    else:
        print(f"❌ ข้อมูลที่ได้ไม่ใช่เลข 13 หลัก (ได้ {len(data)} bytes)")

    step("6) ตัดไฟบัตร (18 02)")
    reply = transport.command(CMD_ICC_SLOT_PWR, bytes([SLOT_MAIN, 0x00]))
    print(f"   status {status_text(reply.status)}")


def read_full(transport: RfproTransport) -> None:
    """S0-6: read the whole card through the kiosk driver; print lengths and timing only."""
    wait_for_card(transport)
    step("4) อ่านข้อมูลทั้งใบด้วย driver เดียวกับ kiosk (ไม่แสดงข้อมูลบัตร)")
    reader = RfproThaiCardReader(transport=transport)
    started = time.monotonic()
    card = reader.read_all_data()
    elapsed = time.monotonic() - started
    for key, value in card.items():
        if value in (None, ""):
            size = "ว่าง"
        elif key == "photo_base64":
            size = f"{len(value)} ตัวอักษร (base64)"
        else:
            size = f"{len(str(value))} ตัวอักษร"
        print(f"   {key:<16} {size}")
    print(f"✅ อ่านครบทั้งใบใน {elapsed:.1f} วิ (AC-C3: ลงทะเบียนต้องไม่เกินค่านี้ + 20%)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("command", nargs="?", default="all", choices=["all", "ping"])
    parser.add_argument("--full", action="store_true", help="อ่านทั้งใบ แสดงเฉพาะความยาว field + เวลา (S0-6)")
    parser.add_argument("--id", default=DEFAULT_ID, help=f"VID:PID (default {DEFAULT_ID})")
    parser.add_argument("--verbose", action="store_true", help="แสดงคำสั่ง/คำตอบ")
    parser.add_argument("--show-cid", action="store_true", help="แสดงเลขบัตรเต็ม")
    args = parser.parse_args()

    if os.geteuid() != 0:
        sys.exit("❌ ต้องรันด้วย sudo (อ่าน/เขียน /dev/hidraw*)")
    try:
        transport = RfproTransport.open(args.id)
    except RfproError as error:
        sys.exit(f"❌ {error} — เสียบ USB ของโมดูลแล้วลองใหม่")
    if args.verbose:
        transport.tracer = make_tracer(args.show_cid)

    try:
        ping(transport)
        if args.command == "all":
            if args.full:
                read_full(transport)
            else:
                read_cid(transport, args.show_cid)
    except (RfproError, InspectError, RuntimeError) as error:
        print(f"\n❌ {error}")
        print("   ลองใหม่ด้วย --verbose แล้วส่งผลให้ทีม dev")
        sys.exit(1)
    finally:
        transport.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nยกเลิก")
