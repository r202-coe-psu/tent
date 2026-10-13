"""Linux hidraw discovery and HID report-descriptor parsing (stdlib only)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

HIDRAW_SYS = Path("/sys/class/hidraw")


@dataclass
class ReportInfo:
    kind: str  # Input / Output / Feature
    report_id: int
    bits: int = 0
    usage_pages: set[int] = field(default_factory=set)


@dataclass
class HidNode:
    dev: str
    interface: str
    descriptor: bytes
    reports: dict[tuple[str, int], ReportInfo]

    @property
    def has_report_ids(self) -> bool:
        return any(rid for _, rid in self.reports)

    def output_bytes(self, report_id: int) -> int:
        info = self.reports.get(("Output", report_id))
        return (info.bits + 7) // 8 if info else 0

    def input_bytes(self, report_id: int) -> int:
        info = self.reports.get(("Input", report_id))
        return (info.bits + 7) // 8 if info else 0


def parse_descriptor(desc: bytes) -> dict[tuple[str, int], ReportInfo]:
    """Sum report sizes per (main item kind, report id) from HID short items."""
    reports: dict[tuple[str, int], ReportInfo] = {}
    usage_page = report_id = report_size = report_count = 0
    i = 0
    while i < len(desc):
        prefix = desc[i]
        if prefix == 0xFE:  # long item: skip
            i += 3 + (desc[i + 1] if i + 1 < len(desc) else 0)
            continue
        size = (0, 1, 2, 4)[prefix & 0x03]
        kind = (prefix >> 2) & 0x03
        tag = prefix >> 4
        value = int.from_bytes(desc[i + 1 : i + 1 + size], "little")
        i += 1 + size
        if kind == 1:  # global
            if tag == 0x0:
                usage_page = value
            elif tag == 0x7:
                report_size = value
            elif tag == 0x8:
                report_id = value
            elif tag == 0x9:
                report_count = value
        elif kind == 0 and tag in (0x8, 0x9, 0xB):  # main: Input / Output / Feature
            name = {0x8: "Input", 0x9: "Output", 0xB: "Feature"}[tag]
            info = reports.setdefault((name, report_id), ReportInfo(name, report_id))
            info.bits += report_size * report_count
            info.usage_pages.add(usage_page)
    return reports


def find_nodes(vid_pid: str, sysfs: Path | None = None) -> list[HidNode]:
    vid, pid = (part.upper().rjust(8, "0") for part in vid_pid.split(":"))
    nodes = []
    for entry in sorted((sysfs or HIDRAW_SYS).glob("hidraw*")):
        device = entry / "device"
        try:
            uevent = (device / "uevent").read_text()
        except OSError:
            continue
        if f"HID_ID=0003:{vid}:{pid}" not in uevent.upper():
            continue
        try:
            interface = (
                (device.resolve().parent / "bInterfaceNumber").read_text().strip()
            )
        except OSError:
            interface = "?"
        try:
            descriptor = (device / "report_descriptor").read_bytes()
        except OSError:
            continue
        nodes.append(
            HidNode(
                f"/dev/{entry.name}",
                interface,
                descriptor,
                parse_descriptor(descriptor),
            )
        )
    return nodes
