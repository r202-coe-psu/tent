"""
ตรวจเครื่องอ่านบัตรแบบ HID (โปรโตคอลเฉพาะผู้ผลิต) ผ่าน /dev/hidraw — stdlib only, ต้องรันด้วย sudo

Manual hardware inspector for the kiosk3 card reader (HOUSESmart 0483:4c43 behind the
YE XIN EF-011C socket), which is NOT PC/SC so app/scard.py cannot see it. Not an automated
test (pytest never collects it); run directly.

Usage:
  sudo python3 inspect_card_hid.py                 # descriptor + capture แบบมีขั้นตอน (read-only)
  sudo python3 inspect_card_hid.py descriptor      # แสดง HID report descriptor อย่างเดียว
  sudo python3 inspect_card_hid.py capture         # ดักฟัง: ไม่มีบัตร → เสียบบัตร → ถอดบัตร
  sudo python3 inspect_card_hid.py send "AA 00 .." [--listen 5]
      ส่ง output report แล้วดักคำตอบ — ใช้เฉพาะคำสั่งจากเอกสารผู้ขาย (อย่าเดาคำสั่ง)
  --id VID:PID  เปลี่ยนอุปกรณ์ (default 0483:4c43)
"""

from __future__ import annotations

import argparse
import os
import select
import sys
import time

from app.hidraw import HidNode, find_nodes

DEFAULT_ID = "0483:4c43"


def hexs(data: bytes) -> str:
    return " ".join(f"{b:02x}" for b in data.rstrip(b"\x00")) or "(ศูนย์ทั้งหมด)"


def show_descriptor(nodes: list[HidNode]) -> None:
    print("━━━ HID report descriptor ━━━")
    for node in nodes:
        print(
            f"{node.dev} (interface {node.interface}), descriptor {len(node.descriptor)} bytes"
        )
        print(f"  raw: {node.descriptor.hex(' ')}")
        if not node.reports:
            print("  (ไม่มี report)")
        for (kind, rid), info in sorted(node.reports.items()):
            pages = ", ".join(f"0x{p:04x}" for p in sorted(info.usage_pages))
            vendor = (
                " ← vendor-defined"
                if any(p >= 0xFF00 for p in info.usage_pages)
                else ""
            )
            print(
                f"  {kind:<7} report-id={rid:<3} {info.bits // 8:>3} bytes  usage-page {pages}{vendor}"
            )
        if any(kind == "Output" for kind, _ in node.reports):
            print("  → interface นี้รับคำสั่ง (Output report) ได้ — คำสั่งอ่านบัตรน่าจะส่งทางนี้")
    print()


def listen(
    fds: dict[int, HidNode], seconds: float, seen: set[bytes], label: str
) -> list[bytes]:
    """Print every report for `seconds`; mark frames never seen before (the interesting ones)."""
    new_frames: list[bytes] = []
    start = time.monotonic()
    while (left := seconds - (time.monotonic() - start)) > 0:
        ready, _, _ = select.select(list(fds), [], [], left)
        for fd in ready:
            data = os.read(fd, 256)
            tag = "NEW " if data not in seen else "    "
            if data not in seen:
                seen.add(data)
                new_frames.append(data)
            elapsed = time.monotonic() - start
            print(f"  [{label} +{elapsed:5.2f}s] {fds[fd].dev} {tag}{hexs(data)}")
    return new_frames


def open_nodes(nodes: list[HidNode], mode: int) -> dict[int, HidNode]:
    return {os.open(node.dev, mode | os.O_NONBLOCK): node for node in nodes}


def capture(nodes: list[HidNode]) -> None:
    fds = open_nodes(nodes, os.O_RDONLY)
    seen: set[bytes] = set()
    phases = [
        ("idle", "ไม่ต้องเสียบบัตร — เก็บ heartbeat ปกติ", 6),
        ("insert", "เสียบบัตรประชาชนตอนนี้ แล้วค้างไว้", 12),
        ("remove", "ถอดบัตรออกตอนนี้", 6),
    ]
    summary = {}
    try:
        for label, prompt, seconds in phases:
            print(f"━━━ {label}: {prompt} ({seconds} วิ) ━━━")
            summary[label] = listen(fds, seconds, seen, label)
    finally:
        for fd in fds:
            os.close(fd)

    print("\n━━━ สรุป ━━━")
    for label in ("insert", "remove"):
        frames = summary[label]
        if frames:
            print(
                f"✅ {label}: มี frame ใหม่ {len(frames)} แบบ — เครื่องรายงานเหตุการณ์บัตรเอง:"
            )
            for frame in frames:
                print(f"     {hexs(frame)}")
        else:
            print(f"❌ {label}: ไม่มี frame ใหม่")
    if not summary["insert"] and not summary["remove"]:
        print(
            "→ เครื่องไม่ส่งข้อมูลเองเมื่อเสียบ/ถอดบัตร: ต้องส่งคำสั่งจากเอกสารผู้ขายก่อน (ใช้คำสั่ง send)"
        )


def send(nodes: list[HidNode], payload_hex: str, listen_seconds: float) -> None:
    payload = bytes.fromhex(payload_hex.replace(" ", "").replace(":", ""))
    targets = [n for n in nodes if any(kind == "Output" for kind, _ in n.reports)]
    if not targets:
        sys.exit("❌ ไม่มี interface ไหนรับ Output report — ส่งคำสั่งไม่ได้")
    node = targets[0]
    # hidraw write: first byte is the report id (0 when the device uses none), then the report,
    # padded to the declared Output size because many devices ignore short reports.
    if node.has_report_ids:
        rid, body = payload[0], payload[1:]
    else:
        rid, body = 0, payload
    size = node.output_bytes(rid)
    if size and len(body) > size:
        sys.exit(f"❌ payload {len(body)} bytes ยาวเกิน Output report ({size} bytes)")
    frame = bytes([rid]) + body.ljust(size, b"\x00")
    fds = open_nodes(nodes, os.O_RDWR)
    try:
        write_fd = next(fd for fd, n in fds.items() if n is node)
        print(f"━━━ ส่งไปที่ {node.dev}: {frame.hex(' ')} ━━━")
        os.write(write_fd, frame)
        frames = listen(fds, listen_seconds, set(), "reply")
    finally:
        for fd in fds:
            os.close(fd)
    print(f"\n{'✅ ได้คำตอบ ' + str(len(frames)) + ' แบบ' if frames else '❌ ไม่มีคำตอบ'}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="all",
        choices=["all", "descriptor", "capture", "send"],
    )
    parser.add_argument("payload", nargs="?", help="hex ของคำสั่ง (เฉพาะ send)")
    parser.add_argument(
        "--id", default=DEFAULT_ID, help=f"VID:PID (default {DEFAULT_ID})"
    )
    parser.add_argument(
        "--listen", type=float, default=5.0, help="วินาทีที่รอคำตอบหลัง send"
    )
    args = parser.parse_args()

    if os.geteuid() != 0:
        sys.exit("❌ ต้องรันด้วย sudo (อ่าน /dev/hidraw*)")
    nodes = find_nodes(args.id)
    if not nodes:
        sys.exit(f"❌ ไม่พบอุปกรณ์ {args.id} — เสียบ USB ของโมดูลเครื่องอ่านบัตรแล้วลองใหม่")

    if args.command in ("all", "descriptor"):
        show_descriptor(nodes)
    if args.command in ("all", "capture"):
        capture(nodes)
    if args.command == "send":
        if not args.payload:
            sys.exit('❌ send ต้องระบุ hex เช่น: send "AA 00 01 ..."')
        send(nodes, args.payload, args.listen)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nยกเลิก")
