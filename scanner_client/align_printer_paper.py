"""
จัดกระดาษสติกเกอร์ (เส้นประทุก 60 มม.) ให้ตรงเส้นประ หลังใส่ม้วนใหม่ในตู้ kiosk3 — ต้องมีสิทธิ์ /dev/usb/lp*

ตอนใส่กระดาษ printer เลื่อนกระดาษเองแล้วตัดเศษทิ้งหนึ่งชิ้น ใบมีดจึงไปหยุดกลางดวง ทุกดวงต่อจากนั้น
(ยาว 60 มม. เท่ากันทุกดวง) เลยคร่อมเส้นประตลอด สคริปต์นี้เลื่อนกระดาษให้เส้นประมาอยู่ที่ใบมีด
แล้วตัดเศษทิ้งอีกชิ้น หลังจากนั้นทุกดวงตรงเส้นประ มี 2 วิธี:

วิธี A — ขีดมาร์คดำ (--mark): ให้เซนเซอร์ black mark ของ printer หาเอง ไม่ต้องวัดเศษ
  1. ขีดมาร์คดำทึบ ~5 มม. (ตามแนวกระดาษ) × 15 มม. ชิดเส้นประ ห่างปลายม้วน 2–3 ดวง
     ด้านที่หันเข้าเซนเซอร์ และตรงแนวเซนเซอร์ (เปิดฝาดูช่องเซนเซอร์ในทางเดินกระดาษ)
     ปากกาเมจิกบางยี่ห้อเซนเซอร์อินฟราเรดมองไม่เห็น → ใช้ดินสอ 2B ฝนหนา ๆ หรือเทปดำแทน
  2. ใส่ม้วน รอเครื่องเลื่อน + ตัดเศษเองให้เสร็จ
  3. venv/bin/python align_printer_paper.py --mark
  4. ดูรอยตัด: ถ้าตัดเลยเส้นประไป X มม. → รอบหน้าใช้ --cut-offset-mm -X, ตัดก่อนถึง X มม. → +X
     (หรือขีดมาร์คให้เยื้องเส้นประไปตามนั้นแทน) · ถ้าเครื่องเลื่อน ~17 ซม. แล้วค่อยตัด = มองไม่เห็นมาร์ค

วิธี B — วัดเศษ (--stub-mm): ไม่ต้องใช้เซนเซอร์
  1. ฉีกปลายม้วนตรงเส้นประ แล้วค่อยใส่เข้าเครื่อง
  2. เครื่องเลื่อนเอง + ตัดเศษทิ้ง → วัดความยาวเศษชิ้นนั้น (มม.) — ควรเท่าเดิมทุกครั้ง จดไว้ใช้ซ้ำได้
  3. venv/bin/python align_printer_paper.py --stub-mm <ความยาวเศษ>
  4. ถ้ายังคลาด X มม. ใส่ม้วนใหม่แล้วรันซ้ำพร้อม --trim-mm X (+ = ให้ตัดเลื่อนลึกเข้าไปในม้วน)
  ถ้าไม่ได้ฉีกตรงเส้นประ: ใช้ระยะจากขอบที่โดนมีดตัดของเศษ ถึงเส้นประที่ใกล้ขอบนั้นที่สุดแทน

ตรวจผลทั้งสองวิธี: python3 inspect_printer_cut.py 7 → ดวงที่ออกมาต้องตัดตรงเส้นประทั้งสองขอบ
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.escpos import CUT_SELF_FEED_MM, LABEL_LENGTH_MM, align_to_black_mark, align_to_perforation
from inspect_printer_cut import find_device, send


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--mark", action="store_true", help="หามาร์คดำที่ขีดไว้แล้วตัดตรงนั้น")
    mode.add_argument("--stub-mm", type=float, help="ความยาวเศษที่เครื่องตัดทิ้งตอนใส่กระดาษ")
    parser.add_argument("--cut-offset-mm", type=float, default=0, help="--mark: เลื่อนรอยตัด (+ = ตัดช้าลง)")
    parser.add_argument("--trim-mm", type=float, default=0, help="--stub-mm: ชดเชยที่ยังคลาด (+ = ตัดช้าลง)")
    parser.add_argument("--device", type=Path)
    parser.add_argument("--usb-id", default="28e9:5812")
    args = parser.parse_args()

    if args.mark:
        try:
            data = align_to_black_mark(args.cut_offset_mm)
        except ValueError:
            print("❌ --cut-offset-mm เกินช่วงที่ printer รับได้ (±187 มม.)", file=sys.stderr)
            return 1
        summary = f"หามาร์คดำ · เลื่อนรอยตัด {args.cut_offset_mm:+g} มม."
    else:
        stub_mm = args.stub_mm
        if stub_mm is None:
            try:
                stub_mm = float(input("ความยาวเศษที่เครื่องตัดทิ้งตอนใส่กระดาษ (มม.): "))
            except ValueError:
                print("❌ ใส่เป็นตัวเลข มม.", file=sys.stderr)
                return 1
        if stub_mm < 0:
            print("❌ ความยาวต้องไม่ติดลบ", file=sys.stderr)
            return 1
        data = align_to_perforation(stub_mm, trim_mm=args.trim_mm)
        if not data:
            print("✅ ใบมีดอยู่ตรงเส้นประแล้ว ไม่ต้องเลื่อน")
            return 0
        summary = (
            f"ดวงละ {LABEL_LENGTH_MM} มม. · เศษ {stub_mm:g} มม. "
            f"· เครื่องเลื่อนเองตอนตัด {CUT_SELF_FEED_MM} มม."
        )

    device = args.device or find_device(args.usb_id)
    if device is None:
        print(f"❌ ไม่พบ printer {args.usb_id} — เปิดเครื่องพิมพ์แล้วหรือยัง? (ดู ls /dev/usb/)", file=sys.stderr)
        return 1
    print(f"▸ printer: {device} · {summary}")
    try:
        send(device, data)
    except PermissionError:
        print(f"❌ ไม่มีสิทธิ์เขียน {device}: sudo usermod -aG lp $USER แล้ว login ใหม่ (หรือรันด้วย sudo)", file=sys.stderr)
        return 1
    print("✅ ตัดแล้ว — ขอบที่ออกมาควรเป็นเส้นประ ลองพิมพ์ทดสอบ: python3 inspect_printer_cut.py 7")
    return 0


if __name__ == "__main__":
    sys.exit(main())
