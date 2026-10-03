"""
Probe: does the vendor's libcomPro.so get a full 255-byte APDU reply from the RFpro/HOUSESmart
module (0483:4c43) in ONE command, and how long does the whole Thai-ID photo take that way?

Our own driver (app/rfpro.py, over /dev/hidraw*) only ever receives the first 32-byte input
report of a reply, so it reads the photo in 20-byte pieces (~17 s). The vendor SDK's own demo
reads replies into a 1024-byte buffer, so its transport must be getting more. This asks the
vendor library for the same thing and prints only lengths, status words and timing (never card
data), so an `strace` of it shows what the vendor library does differently.

Run with the kiosk stopped (it holds the reader) and an ID card inserted. Needs the SDK's
Linux library (x64/libcomPro.so) and /dev/usb/hiddev* (kernel hiddev; `ls /dev/usb/`):

  pkill -f start_kiosk.sh; pkill -f 'main.py'
  sudo python3 tools/vendor_apdu_probe.py --lib "$HOME/Downloads/RFpro-CH_20260312(zh)/linux/x64/libcomPro.so"
  sudo strace -f -tt -e trace=ioctl,read,write,poll,select -o /tmp/vendor.strace \\
       python3 tools/vendor_apdu_probe.py --lib ...
"""

from __future__ import annotations

import argparse
import ctypes
import os
import sys
import time

THAI_SELECT = bytes([0x00, 0xA4, 0x04, 0x00, 0x08, 0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01])
PHOTO_CHUNKS = 20


class Vendor:
    """The slice of the SDK this probe uses (prototypes from SDK_API函数接口_v1.21.pdf)."""

    def __init__(self, path: str) -> None:
        lib = ctypes.CDLL(path)
        uchar_p = ctypes.POINTER(ctypes.c_ubyte)
        lib.lc_init_ex.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_long]
        lib.lc_exit.argtypes = [ctypes.c_int]
        lib.lc_getver.argtypes = [ctypes.c_int, ctypes.c_char_p]
        lib.lc_iccGetCardState.argtypes = [ctypes.c_int, ctypes.c_ubyte, uchar_p]
        lib.lc_iccSelCardType.argtypes = [ctypes.c_int, ctypes.c_ubyte, ctypes.c_uint]
        lib.lc_iccGetATR.argtypes = [ctypes.c_int, ctypes.c_ubyte, uchar_p, uchar_p]
        lib.lc_icc_APDU.argtypes = [
            ctypes.c_int,
            ctypes.c_ubyte,
            ctypes.c_uint,
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_uint),
            uchar_p,
        ]
        self.lib = lib

    def apdu(self, dev: int, command: bytes) -> bytes:
        """One APDU through lc_icc_APDU; the reply includes the trailing SW1 SW2."""
        reply = (ctypes.c_ubyte * 1100)()
        rlen = ctypes.c_uint(0)
        status = self.lib.lc_icc_APDU(dev, 0, len(command), command, ctypes.byref(rlen), reply)
        if status != 0:
            raise RuntimeError(f"lc_icc_APDU error {status}")
        return bytes(reply[: rlen.value])


def timed(label: str, vendor: Vendor, dev: int, command: bytes) -> bytes:
    started = time.monotonic()
    try:
        reply = vendor.apdu(dev, command)
    except RuntimeError as error:
        print(f"  {label:<28} {error} ({(time.monotonic() - started) * 1000:.0f} ms)")
        raise
    sw = reply[-2:].hex().upper() if len(reply) >= 2 else "----"
    print(
        f"  {label:<28} reply {len(reply):3d} bytes  SW {sw}  "
        f"{(time.monotonic() - started) * 1000:.0f} ms"
    )
    return reply


def open_reader(vendor: Vendor) -> int:
    for index in range(10):
        node = f"/dev/usb/hiddev{index}"
        dev = vendor.lib.lc_init_ex(2, node.encode(), 115200)
        print(f"lc_init_ex({node}) -> {dev}")
        if dev == -1:
            continue
        version = ctypes.create_string_buffer(64)
        if vendor.lib.lc_getver(dev, version) == 0:
            print(f"version: {version.value.decode('ascii', 'replace')}")
            return dev
        vendor.lib.lc_exit(dev)
    sys.exit("no reader opened (is /dev/usb/hiddev* present? run as root?)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--lib", required=True, help="path to the SDK's x64/libcomPro.so")
    args = parser.parse_args()
    if not os.path.isfile(args.lib):
        # An empty path would make ctypes load this very process and fail with a confusing
        # "undefined symbol: lc_init_ex".
        sys.exit(f"--lib {args.lib!r} is not a file: copy x64/libcomPro.so from the SDK to this machine")

    vendor = Vendor(args.lib)
    dev = open_reader(vendor)
    try:
        state = ctypes.c_ubyte(0)
        if vendor.lib.lc_iccGetCardState(dev, 0, ctypes.byref(state)) != 0 or not state.value & 1:
            sys.exit("no card in the slot")
        vendor.lib.lc_iccSelCardType(dev, 0, 0x0C)
        atr = (ctypes.c_ubyte * 64)()
        atr_len = ctypes.c_ubyte(0)
        if vendor.lib.lc_iccGetATR(dev, 0, atr, ctypes.byref(atr_len)) != 0:
            sys.exit("ATR failed")
        atr_bytes = bytes(atr[: atr_len.value])
        print(f"ATR ({len(atr_bytes)} bytes): {atr_bytes.hex(' ').upper()}")

        # Same GET RESPONSE rule as app/scard.py: ATR 3B 67 cards use P2 = 01.
        get_response = bytes([0x00, 0xC0, 0x00, 0x01 if atr_bytes[:2] == b"\x3b\x67" else 0x00, 0xFF])

        print("one chunk, as the card allows it:")
        timed("SELECT applet", vendor, dev, THAI_SELECT)
        timed("READ BINARY photo 1 (Le FF)", vendor, dev, bytes([0x80, 0xB0, 0x01, 0x7B, 0x02, 0x00, 0xFF]))
        reply = timed("GET RESPONSE (Le FF)", vendor, dev, get_response)
        verdict = "WORKS" if len(reply) >= 100 else "does NOT arrive"
        print(f">> long reply {verdict} ({len(reply)} bytes; 257 = 255 data + SW)")

        print(f"whole photo, {PHOTO_CHUNKS} chunks of 255:")
        started = time.monotonic()
        total = failed = 0
        for index in range(PHOTO_CHUNKS):
            try:
                vendor.apdu(dev, bytes([0x80, 0xB0, index + 1, 0x7B - index, 0x02, 0x00, 0xFF]))
                data = vendor.apdu(dev, get_response)
            except RuntimeError:
                failed += 1
                continue
            total += max(len(data) - 2, 0)
        print(f">> {total} photo bytes in {time.monotonic() - started:.1f} s, {failed} failed chunks")
    finally:
        vendor.lib.lc_exit(dev)


if __name__ == "__main__":
    main()
