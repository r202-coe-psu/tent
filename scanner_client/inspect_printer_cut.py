"""
ทดสอบคำสั่งตัดกระดาษ + วัดระยะหัวพิมพ์→ใบมีด ของ printer ESC/POS ตู้ kiosk3 — ต้องมีสิทธิ์ /dev/usb/lp* (กลุ่ม lp หรือ sudo)

Manual hardware inspector for the 28e9:5812 receipt printer. Each test prints a numbered strip:
a 1 mm black line at the top, the test name, a 1 mm line at the bottom, then that test's
feed + cut command. After the run, check for each number: was it cut off? how long is the strip?
Not an automated test; run directly from scanner_client/.

Usage:
  python3 inspect_printer_cut.py                 # ทุกเทสต์ (1–5) ทีละอัน กด Enter ระหว่างเทสต์
  python3 inspect_printer_cut.py 1 3             # เฉพาะเทสต์ 1 และ 3
  python3 inspect_printer_cut.py --list          # แสดงรายการเทสต์
  --device /dev/usb/lp3    ใช้ path ตรง ๆ แทนการหาจาก --usb-id (default 28e9:5812)
  --feed-mm 15             ระยะ ESC J ก่อนตัดของเทสต์ 1–3 (default 15 = PRINTER_CUT_FEED_MM)
  --black-mark             เพิ่มเทสต์ 6: GS V B 0 (ผูกกับ black mark — บนม้วนธรรมดาเลื่อน ~17 ซม.)
  7                        label จริงจาก app/escpos.py (ต้องใช้ .venv/bin/python): กรอบสูง 50 มม.
                           → แถบที่ตัดต้องยาว LABEL_LENGTH_MM (60) และเส้นบน-ล่างห่างกัน 50 มม.

Reading the results:
  * test 0 (calibrate): distance from the bottom line to the cut edge = head-to-cutter distance
    → use it as PRINTER_CUT_FEED_MM (round up 1–2 mm).
  * a test that cuts with a short strip = a cut command that works without black-mark hunting.
  * every test runs on plain roll paper; a strip much longer than its content means the
    printer is in black-mark / label mode (fix in the printer's setup, not in the kiosk).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ESC_INIT = b"\x1b@\x1c."
DOTS_PER_MM = 8
WIDTH_DOTS = 576

USBMISC_SYSFS = Path("/sys/class/usbmisc")
USB_DEV_DIR = Path("/dev/usb")


def feed(mm: float) -> bytes:
    out = bytearray()
    dots = round(mm * DOTS_PER_MM)
    while dots > 0:
        step = min(dots, 255)
        out += b"\x1bJ" + bytes([step])
        dots -= step
    return bytes(out)


def black_line(height_dots: int = 8) -> bytes:
    row_bytes = WIDTH_DOTS // 8
    header = b"\x1dv0\x00" + row_bytes.to_bytes(2, "little") + height_dots.to_bytes(2, "little")
    return header + b"\xff" * (row_bytes * height_dots)


def strip(number: int, name: str, tail: bytes) -> bytes:
    text = f"TEST {number}: {name}\n".encode("ascii")
    # ESC ! 0x30 = double width + height so the number is readable on the cut strip.
    return (
        ESC_INIT
        + black_line()
        + b"\x1b!\x30"
        + text
        + b"\x1b!\x00"
        + b"line to line = content height\n"
        + black_line()
        + tail
    )


def tests(feed_mm: float, black_mark: bool) -> dict[int, tuple[str, bytes]]:
    table = {
        0: ("calibrate: ESC i, no feed", b"\x1bi"),
        1: (f"ESC J {feed_mm:g}mm + ESC i (current)", feed(feed_mm) + b"\x1bi"),
        2: (f"ESC J {feed_mm:g}mm + ESC m", feed(feed_mm) + b"\x1bm"),
        3: (f"ESC J {feed_mm:g}mm + GS V 0", feed(feed_mm) + b"\x1dV\x00"),
        4: ("GS V A 0 (feed to cutter + cut)", b"\x1dVA\x00"),
        5: ("GS V 1 partial, after 15mm", feed(15) + b"\x1dV\x01"),
    }
    if black_mark:
        table[6] = ("GS V B 0 (old code)", b"\x1dVB\x00")
    return table


def app_label() -> bytes:
    """Two 1 mm bars 50 mm apart, sent exactly the way the kiosk sends a label."""
    import io

    from PIL import Image

    from app.escpos import CUT_SELF_FEED_MM, DEFAULT_CUT_FEED_MM, LABEL_LENGTH_MM, label_to_escpos

    image = Image.new("L", (WIDTH_DOTS, 50 * DOTS_PER_MM), 255)
    image.paste(0, (0, 0, WIDTH_DOTS, DOTS_PER_MM))
    image.paste(0, (0, image.height - DOTS_PER_MM, WIDTH_DOTS, image.height))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    print(
        f"  app: LABEL_LENGTH_MM={LABEL_LENGTH_MM} DEFAULT_CUT_FEED_MM={DEFAULT_CUT_FEED_MM} "
        f"CUT_SELF_FEED_MM={CUT_SELF_FEED_MM}"
    )
    return label_to_escpos(
        buffer.getvalue(),
        WIDTH_DOTS,
        label_length_mm=LABEL_LENGTH_MM,
        self_feed_mm=CUT_SELF_FEED_MM,
    )


def find_device(usb_id: str) -> Path | None:
    for entry in sorted(USBMISC_SYSFS.glob("lp*")):
        usb_device = Path(os.path.realpath(entry / "device")).parent
        try:
            vendor = (usb_device / "idVendor").read_text().strip().lower()
            product = (usb_device / "idProduct").read_text().strip().lower()
        except OSError:
            continue
        if f"{vendor}:{product}" == usb_id.lower():
            return USB_DEV_DIR / entry.name
    return None


def send(device: Path, data: bytes) -> None:
    # Blocking writes; the sleep lets usblp finish the last URB so the cut is not dropped on close.
    with open(device, "wb", buffering=0) as handle:
        handle.write(data)
        time.sleep(1.5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("only", nargs="*", type=int, help="test numbers to run (default: all)")
    parser.add_argument("--device", type=Path)
    parser.add_argument("--usb-id", default="28e9:5812")
    parser.add_argument("--feed-mm", type=float, default=15)
    parser.add_argument("--black-mark", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    table = tests(args.feed_mm, args.black_mark)
    table[7] = ("app label (60 mm strip, bars 50 mm apart)", b"")
    if args.list:
        for number, (name, _) in table.items():
            print(f"  {number}: {name}")
        return 0

    device = args.device or find_device(args.usb_id)
    if device is None:
        print(f"❌ ไม่พบ printer {args.usb_id} — เปิดเครื่องพิมพ์แล้วหรือยัง? (ดู ls /dev/usb/)", file=sys.stderr)
        return 1
    selected = args.only or list(table)
    unknown = [n for n in selected if n not in table]
    if unknown:
        print(f"❌ ไม่มีเทสต์ {unknown} (ดู --list)", file=sys.stderr)
        return 1

    print(f"▸ printer: {device}")
    for index, number in enumerate(selected):
        name, tail = table[number]
        if index:
            input("  Enter = เทสต์ถัดไป (Ctrl+C = หยุด) ")
        print(f"▸ TEST {number}: {name}")
        try:
            send(device, app_label() if number == 7 else strip(number, name, tail))
        except PermissionError:
            print(f"❌ ไม่มีสิทธิ์เขียน {device}: sudo usermod -aG lp $USER แล้ว login ใหม่ (หรือรันด้วย sudo)", file=sys.stderr)
            return 1
    print("✅ จบ — จดว่าเทสต์ไหนถูกตัด และแต่ละแถบยาวกี่ ซม. (วัดจากขอบตัดถึงขอบตัด)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
