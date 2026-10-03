"""
ทดสอบอ่านบัตรประชาชนผ่านเครื่องอ่าน HID ของตู้ kiosk3 (RFpro/comPro protocol) — ต้องมีสิทธิ์ /dev/hidraw* (./setup_card_reader.sh หรือ sudo)

Manual hardware inspector for the HOUSESmart 0483:4c43 card reader (YE XIN EF-011C socket).
Uses the same driver as the kiosk (`app/rfpro.py`: frame codec, command allowlist, hidraw
transport), so a pass here means the kiosk driver works on this machine. Not an automated
test; run directly from scanner_client/.

Only the driver's command allowlist is ever sent (no flash/reboot commands; --baud adds 18 82):
  00 00 hardware version · 18 00 card state · 18 01 select card type · 18 02 slot power
  18 80 reset card (ATR) · 18 82 card baud (38400 by default) · 18 81 APDU (SELECT Thai ID applet, read CID, GET RESPONSE only)

Usage:
  sudo python3 inspect_card_rfpro.py            # ทุกขั้น: version → สถานะบัตร → รอเสียบบัตร → ATR → อ่านเลขบัตร
  sudo python3 inspect_card_rfpro.py ping       # ขั้น 1–2 อย่างเดียว (ไม่ต้องมีบัตร)
  sudo python3 inspect_card_rfpro.py --full     # S0-6: อ่านทั้งใบ แสดงเฉพาะความยาวแต่ละ field + เวลา (ไม่แสดงข้อมูล)
  sudo python3 inspect_card_rfpro.py --full --baud 38400   # ทดลองเท่านั้น: บน kiosk3 บัตรไม่ตอบรีเซ็ตที่ 38400 (default ของ inspector/kiosk = 9600)
  python3 inspect_card_rfpro.py long-reply --verbose  # ดึงคำตอบยาว 1 รายการ (ชื่อไทย) แล้วรายงานเฉพาะโครงสร้างแพ็กเก็ต HID
  --verbose     แสดงคำสั่ง/คำตอบ (ข้อมูลบัตรใน APDU reply ถูกปิด เว้นแต่ใส่ --show-cid)
  --show-cid    แสดงเลขบัตรเต็ม (default ปิดบังกลางเลข)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from app.hidraw import find_nodes
from app.rfpro import (
    CARD_CPU_7816,
    CMD_HW_VER,
    CMD_ICC_APDU,
    CMD_ICC_GETATR,
    CMD_ICC_SEL,
    CMD_ICC_SET_BAUD,
    CMD_ICC_SLOT_PWR,
    CMD_ICC_ST,
    DEFAULT_CARD_BAUD,
    FAST_CARD_BAUD,
    CARD_BAUDS,
    HEARTBEAT,
    SLOT_MAIN,
    RfproConnection,
    RfproError,
    RfproThaiCardReader,
    RfproTransport,
    _xor,
    build_frame,
    parse_frame,
)
from app.scard import CMD_THFULLNAME, SELECT, THAI_CARD_AID
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
    print(
        f"✅ status {status_text(reply.status)} · data {reply.data.hex(' ')} · '{text}'"
    )
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


def read_cid(transport: RfproTransport, show_cid: bool, baud: int = DEFAULT_CARD_BAUD) -> None:
    wait_for_card(transport)

    step("4) เลือกบัตร CPU ISO 7816 (18 01) + รีเซ็ตบัตร (18 80)")
    reply = transport.command(CMD_ICC_SEL, bytes([SLOT_MAIN, CARD_CPU_7816]))
    print(f"   select type: status {status_text(reply.status)}")
    if baud != DEFAULT_CARD_BAUD:
        reply = transport.command(
            CMD_ICC_SET_BAUD, bytes([SLOT_MAIN]) + baud.to_bytes(4, "big")
        )
        print(f"   set card baud {baud} (18 82): status {status_text(reply.status)}")
    reply = transport.command(CMD_ICC_GETATR, bytes([SLOT_MAIN]))
    if reply.status != 0x00:
        print(
            f"   ATR ครั้งแรก: status {status_text(reply.status)} → ตัดไฟ/จ่ายไฟบัตรใหม่ (18 02) แล้วลองอีกครั้ง"
        )
        for act in (0x00, 0x01):
            power = transport.command(CMD_ICC_SLOT_PWR, bytes([SLOT_MAIN, act]))
            print(
                f"   slot power {'on' if act else 'off'}: status {status_text(power.status)}"
            )
            time.sleep(0.3)
        if baud != DEFAULT_CARD_BAUD:
            transport.command(CMD_ICC_SET_BAUD, bytes([SLOT_MAIN]) + baud.to_bytes(4, "big"))
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


def read_full(transport: RfproTransport, baud: int = DEFAULT_CARD_BAUD) -> None:
    """S0-6: read the whole card through the kiosk driver; print lengths and timing only."""
    wait_for_card(transport)
    step(f"4) อ่านข้อมูลทั้งใบด้วย driver เดียวกับ kiosk (card baud {baud}; ไม่แสดงข้อมูลบัตร)")
    reader = RfproThaiCardReader(transport=transport, baud=baud)
    commands = 0
    send = transport.command

    def counted(*args, **kwargs):
        nonlocal commands
        commands += 1
        return send(*args, **kwargs)

    transport.command = counted
    started = time.monotonic()
    try:
        card = reader.read_all_data()
    finally:
        transport.command = send
    elapsed = time.monotonic() - started
    for key, value in card.items():
        if value in (None, ""):
            size = "ว่าง"
        elif key == "photo_base64":
            size = f"{len(value)} ตัวอักษร (base64)"
        else:
            size = f"{len(str(value))} ตัวอักษร"
        print(f"   {key:<16} {size}")
    print(f"   {commands} คำสั่ง · เฉลี่ย {elapsed / max(commands, 1) * 1000:.0f} ms/คำสั่ง")
    print(f"✅ อ่านครบทั้งใบใน {elapsed:.1f} วิ (AC-C3: ลงทะเบียนต้องไม่เกินค่านี้ + 20%)")


def long_reply(transport: RfproTransport, usb_id: str) -> None:
    """Capture the raw HID reports of one long APDU reply and print only their structure.

    Diagnoses replies that span several reports: counts, sizes, the length the frame declares
    versus the bytes that arrived, and which reassembly layouts give a valid checksum. No card
    data is printed (only the 9 header bytes of the frame, which carry no card content)."""
    wait_for_card(transport)
    nodes = [n for n in find_nodes(usb_id) if any(k == "Output" for k, _ in n.reports)]
    if nodes:
        info = nodes[0].reports.get(("Input", next((r for k, r in nodes[0].reports if k == "Input"), 0)))
        print(f"   descriptor: Input report {(info.bits + 7) // 8 if info else '?'} bytes")

    step("4) ดึงคำตอบยาว: ชื่อไทย (GET RESPONSE ~100 bytes)")
    connection = RfproConnection(transport)
    connection.connect()
    connection.transmit(list(APDU_SELECT_THAI))
    _, sw1, sw2 = connection.transmit(list(CMD_THFULLNAME))
    print(f"   อ่านชื่อ → SW {sw1:02X} {sw2:02X} (ต้องเป็น 61 xx)")
    atr = bytes(connection.getATR())
    get_response = bytes([0x00, 0xC0, 0x00, 0x01 if atr[:2] == b"\x3b\x67" else 0x00, sw2])

    started = time.monotonic()
    reports: list[tuple[float, bytes]] = []
    with transport._lock:
        transport._inx = (transport._inx % 255) + 1
        frame = build_frame(
            transport._inx, CMD_ICC_APDU, bytes([SLOT_MAIN]) + get_response
        )
        transport._drain()
        transport._write(frame)
        while time.monotonic() - started < 4.0:
            report = transport._read_report(0.25)
            if report is not None:
                reports.append((time.monotonic() - started, report))

    data_reports = []
    for number, (at, report) in enumerate(reports):
        try:
            frame = parse_frame(report) if report[:1] == b"\xaa" else None
        except RfproError:
            frame = None
        is_heartbeat = frame is not None and frame.cmd == HEARTBEAT
        kind = "heartbeat" if is_heartbeat else "data"
        print(f"   report {number}: {len(report)} bytes · {kind} · +{at * 1000:.0f} ms")
        if not is_heartbeat:
            data_reports.append(report)
    if not data_reports:
        raise InspectError("ไม่มี report ข้อมูลตอบกลับเลยใน 4 วินาที (ไม่ใช่แค่ตกหล่น: เครื่องไม่ส่งอะไรมา)")

    first = data_reports[0]
    start = first.find(b"\xaa")
    if start < 0 or len(first) < start + 4:
        raise InspectError("report แรกไม่มี STX/ความยาว")
    declared = int.from_bytes(first[start + 2 : start + 4], "big") + 5
    print(f"   header (9 bytes): {first[start : start + 9].hex(' ')}")
    stream = first[start:] + b"".join(data_reports[1:])
    print(f"   เฟรมประกาศความยาว {declared} bytes · ได้รับจริง {len(stream)} bytes ({len(data_reports)} reports)")

    layouts = {
        "ต่อกันตรง ๆ (โค้ดปัจจุบัน)": first[start:] + b"".join(data_reports[1:]),
        "ตัด 1 byte หน้า report ต่อเนื่อง": first[start:] + b"".join(r[1:] for r in data_reports[1:]),
        "ตัด 2 bytes หน้า report ต่อเนื่อง": first[start:] + b"".join(r[2:] for r in data_reports[1:]),
    }
    for name, joined in layouts.items():
        chunk = joined[:declared]
        valid = len(chunk) == declared and _xor(chunk[1:-1]) == chunk[-1]
        print(f"   {'✅' if valid else '❌'} checksum · {name}")


def other_openers(dev: str, proc: Path = Path("/proc")) -> list[tuple[int, str]]:
    """Other processes holding `dev` open. hidraw delivers every input report to every opener,
    and the kiosk resets the card as soon as it sees one inserted, so a run beside it measures
    the kiosk's traffic mixed with its own. Reading other users' fds needs root."""
    found = []
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            held = any(os.readlink(fd) == dev for fd in (entry / "fd").iterdir())
            command = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            continue
        if held:
            found.append((int(entry.name), command.strip()[:80]))
    return found


def refuse_if_busy(usb_id: str) -> None:
    node = next((n for n in find_nodes(usb_id) if any(k == "Output" for k, _ in n.reports)), None)
    busy = other_openers(node.dev) if node else []
    if not busy:
        return
    lines = "\n".join(f"   pid {pid}: {command}" for pid, command in busy)
    sys.exit(
        f"❌ มี process อื่นเปิด {node.dev} อยู่ (น่าจะเป็น kiosk) — ผลที่วัดจะปนกับคำสั่งของ process นั้น\n"
        f"{lines}\n"
        "   หยุด kiosk ก่อน: pkill -f start_kiosk.sh; pkill -f 'main.py'\n"
        "   (ตู้ล็อกหน้าจอจะเปิด kiosk ใหม่เองใน 30 วิ — รันทันทีหลังหยุด; หรือใส่ --force ถ้ารู้ตัวว่ายอมรับผลปนกัน)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("command", nargs="?", default="all", choices=["all", "ping", "long-reply"])
    parser.add_argument(
        "--full",
        action="store_true",
        help="อ่านทั้งใบ แสดงเฉพาะความยาว field + เวลา (S0-6)",
    )
    parser.add_argument(
        "--id", default=DEFAULT_ID, help=f"VID:PID (default {DEFAULT_ID})"
    )
    parser.add_argument(
        "--baud",
        type=int,
        choices=CARD_BAUDS,
        default=DEFAULT_CARD_BAUD,
        help=f"ความเร็วสายระหว่างโมดูลกับบัตร (default {DEFAULT_CARD_BAUD} = ค่าที่ kiosk ใช้; {FAST_CARD_BAUD} ส่ง 18 82 ก่อน ATR — kiosk3 บัตรไม่ตอบรีเซ็ต)",
    )
    parser.add_argument("--verbose", action="store_true", help="แสดงคำสั่ง/คำตอบ")
    parser.add_argument(
        "--force", action="store_true", help="รันต่อแม้มี process อื่นเปิดเครื่องอ่านอยู่"
    )
    parser.add_argument("--show-cid", action="store_true", help="แสดงเลขบัตรเต็ม")
    args = parser.parse_args()

    if not args.force:
        refuse_if_busy(args.id)
    # No root check: run it as the kiosk user to prove the udev permission works the same way
    # the kiosk opens the device. The transport error says whether it is permission or absence.
    try:
        transport = RfproTransport.open(args.id)
    except RfproError as error:
        sys.exit(
            f"❌ {error}\n   ตรวจสิทธิ์: ./setup_card_reader.sh --status · หรือเสียบ USB ของโมดูลแล้วลองใหม่"
        )
    if args.verbose:
        transport.tracer = make_tracer(args.show_cid)

    try:
        ping(transport)
        if args.command == "long-reply":
            long_reply(transport, args.id)
        elif args.command == "all":
            if args.full:
                read_full(transport, args.baud)
            else:
                read_cid(transport, args.show_cid, args.baud)
    except (RfproError, InspectError, RuntimeError, ValueError) as error:
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
