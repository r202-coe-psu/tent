import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import hidraw, rfpro
from app.hidraw import HidNode, find_nodes, parse_descriptor
from app.rfpro import RfproDeviceLostError, RfproTransport

READER_ID = "0483:4c43"


def descriptor(
    *, input_bytes: int, output_bytes: int = 0, report_id: int | None = None
) -> bytes:
    """Vendor-defined HID report descriptor with one Input and (optionally) one Output report."""
    out = bytearray(
        b"\x06\x00\xff\x09\x01\xa1\x01"
    )  # usage page FF00, usage 1, application
    if report_id is not None:
        out += bytes([0x85, report_id])
    out += b"\x15\x00\x26\xff\x00\x75\x08"  # logical 0..255, report size 8
    out += bytes([0x95, input_bytes, 0x09, 0x01, 0x81, 0x02])  # Input
    if output_bytes:
        out += bytes([0x95, output_bytes, 0x09, 0x01, 0x91, 0x02])  # Output
    out += b"\xc0"
    return bytes(out)


class FakeHidSysfs:
    def __init__(self, test: unittest.TestCase):
        tmp = tempfile.TemporaryDirectory()
        test.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def add(self, name, hid_id, desc, *, interface="0"):
        node = self.root / name
        (node / "device").mkdir(parents=True)
        (node / "device" / "uevent").write_text(
            f"DRIVER=hid-generic\nHID_ID={hid_id}\n"
        )
        if desc is not None:
            (node / "device" / "report_descriptor").write_bytes(desc)
        if interface is not None:
            (node / "bInterfaceNumber").write_text(interface + "\n")
        return node


class ParseDescriptorTests(unittest.TestCase):
    def test_sizes_without_report_ids(self):
        reports = parse_descriptor(descriptor(input_bytes=32, output_bytes=32))

        self.assertEqual(
            {k: v.bits // 8 for k, v in reports.items()},
            {("Input", 0): 32, ("Output", 0): 32},
        )

    def test_sizes_with_a_report_id(self):
        node = HidNode(
            "/dev/x",
            "0",
            b"",
            parse_descriptor(descriptor(input_bytes=64, output_bytes=64, report_id=1)),
        )

        self.assertTrue(node.has_report_ids)
        self.assertEqual(node.output_bytes(1), 64)
        self.assertEqual(node.output_bytes(0), 0)

    def test_input_only_interface_has_no_output_report(self):
        reports = parse_descriptor(descriptor(input_bytes=8))

        self.assertNotIn(("Output", 0), reports)


class FindNodesTests(unittest.TestCase):
    def test_matches_vid_pid_case_insensitively_and_reads_the_interface(self):
        sysfs = FakeHidSysfs(self)
        sysfs.add(
            "hidraw5",
            "0003:00000483:00004C43",
            descriptor(input_bytes=32, output_bytes=32),
            interface="0",
        )
        sysfs.add(
            "hidraw1", "0003:00000461:00004D81", descriptor(input_bytes=8)
        )  # CROWN, not ours

        nodes = find_nodes(READER_ID, sysfs.root)

        self.assertEqual([(n.dev, n.interface) for n in nodes], [("/dev/hidraw5", "0")])
        self.assertEqual(nodes[0].output_bytes(0), 32)

    def test_missing_interface_number_or_descriptor_does_not_crash(self):
        sysfs = FakeHidSysfs(self)
        sysfs.add(
            "hidraw2",
            "0003:00000483:00004C43",
            descriptor(input_bytes=32, output_bytes=32),
            interface=None,
        )
        sysfs.add("hidraw3", "0003:00000483:00004C43", None)  # descriptor unreadable
        (sysfs.root / "hidraw4").mkdir()  # no uevent at all

        nodes = find_nodes(READER_ID, sysfs.root)

        self.assertEqual([(n.dev, n.interface) for n in nodes], [("/dev/hidraw2", "?")])


class TransportOpenTests(unittest.TestCase):
    def node(self, dev, desc):
        return HidNode(dev, "0", desc, parse_descriptor(desc))

    def test_opens_the_interface_that_has_an_output_report_with_its_report_size(self):
        with tempfile.NamedTemporaryFile() as target:
            nodes = [
                self.node(
                    "/dev/hidraw4", descriptor(input_bytes=8)
                ),  # input-only interface
                self.node(
                    target.name,
                    descriptor(input_bytes=64, output_bytes=64, report_id=1),
                ),
            ]
            with patch.object(rfpro, "find_nodes", return_value=nodes):
                transport = RfproTransport.open(READER_ID)
            self.addCleanup(transport.close)

            self.assertEqual(
                (transport._report_id, transport._out_size, transport._has_report_ids),
                (1, 64, True),
            )

    def test_unnumbered_reports_use_report_id_zero(self):
        with tempfile.NamedTemporaryFile() as target:
            nodes = [
                self.node(target.name, descriptor(input_bytes=32, output_bytes=32))
            ]
            with patch.object(rfpro, "find_nodes", return_value=nodes):
                transport = RfproTransport.open(READER_ID)
            self.addCleanup(transport.close)

            self.assertEqual(
                (transport._report_id, transport._out_size, transport._has_report_ids),
                (0, 32, False),
            )

    def test_no_matching_interface_is_reported_as_device_missing(self):
        nodes = [self.node("/dev/hidraw4", descriptor(input_bytes=8))]
        with (
            patch.object(rfpro, "find_nodes", return_value=nodes),
            self.assertRaisesRegex(RfproDeviceLostError, "not found"),
        ):
            RfproTransport.open(READER_ID)

    def test_permission_error_points_at_the_udev_rule(self):
        nodes = [self.node("/dev/hidraw5", descriptor(input_bytes=32, output_bytes=32))]
        with (
            patch.object(rfpro, "find_nodes", return_value=nodes),
            patch.object(rfpro.os, "open", side_effect=PermissionError),
            self.assertRaisesRegex(RfproDeviceLostError, "udev rule"),
        ):
            RfproTransport.open(READER_ID)

    def test_hidraw_module_default_sysfs_root_is_the_kernel_one(self):
        self.assertEqual(hidraw.HIDRAW_SYS, Path("/sys/class/hidraw"))


if __name__ == "__main__":
    unittest.main()
