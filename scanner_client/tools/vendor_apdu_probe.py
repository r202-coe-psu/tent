"""
Probe: how many bytes of one APDU reply does the vendor's libcomPro.so get from the RFpro/
HOUSESmart module (0483:4c43), and how long does the whole Thai-ID photo take with the largest
piece that works? (A 255-byte reply failed with API error 383 = checksum error, i.e. the
reply arrived truncated, so this walks the sizes up to find the limit.)

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


PHOTO_START = 0x017B
PHOTO_LENGTH = 255 * PHOTO_CHUNKS
LADDER = (20, 21, 24, 32, 48, 64, 100, 128, 200, 255)


def reset_card(vendor: Vendor, dev: int) -> bytes:
    vendor.lib.lc_iccSelCardType(dev, 0, 0x0C)
    atr = (ctypes.c_ubyte * 64)()
    atr_len = ctypes.c_ubyte(0)
    if vendor.lib.lc_iccGetATR(dev, 0, atr, ctypes.byref(atr_len)) != 0:
        raise RuntimeError("ATR failed")
    return bytes(atr[: atr_len.value])


def read_piece(vendor: Vendor, dev: int, get_response: bytes, offset: int, length: int) -> bytes:
    """READ BINARY of `length` bytes at `offset` + GET RESPONSE, like app/rfpro.py's pieces."""
    vendor.apdu(dev, bytes([0x80, 0xB0, offset >> 8, offset & 0xFF, 0x02, 0x00, length]))
    return vendor.apdu(dev, get_response + bytes([length]))


def trace_pair(vendor: Vendor, dev: int, atr: bytes) -> None:
    """Two pieces, so an strace of this run is short: Le 48 worked and Le 32 failed (error 383)."""
    get_response = bytes([0x00, 0xC0, 0x00, 0x01 if atr[:2] == b"\x3b\x67" else 0x00])
    vendor.apdu(dev, THAI_SELECT)
    for length in (48, 32):
        print(f"--- Le {length}", flush=True)
        try:
            reply = read_piece(vendor, dev, get_response, PHOTO_START, length)
            print(f"    reply {len(reply)} bytes, SW {reply[-2:].hex().upper()}", flush=True)
        except RuntimeError as error:
            print(f"    {error}", flush=True)
            reset_card(vendor, dev)
            vendor.apdu(dev, THAI_SELECT)


def ladder(vendor: Vendor, dev: int, atr: bytes) -> None:
    """Find the largest piece the vendor library reads correctly, then time the whole photo with
    it. A failed size is reported and the card is reset before the next one."""
    # Same GET RESPONSE rule as app/scard.py: ATR 3B 67 cards use P2 = 01.
    get_response = bytes([0x00, 0xC0, 0x00, 0x01 if atr[:2] == b"\x3b\x67" else 0x00])
    print("piece sizes (READ BINARY + GET RESPONSE, same Le):")
    best = 0
    for length in LADDER:
        started = time.monotonic()
        try:
            vendor.apdu(dev, THAI_SELECT)
            reply = read_piece(vendor, dev, get_response, PHOTO_START, length)
            ok = len(reply) == length + 2 and reply[-2:] == b"\x90\x00"
            verdict = "OK" if ok else f"short/odd ({len(reply)} bytes, SW {reply[-2:].hex().upper()})"
        except RuntimeError as error:
            ok, verdict = False, str(error)
            try:
                reset_card(vendor, dev)
            except RuntimeError:
                print("  (card did not answer reset after the error — stopping)")
                break
        print(f"  Le {length:3d}: {verdict:<44} {(time.monotonic() - started) * 1000:5.0f} ms")
        if ok:
            best = length
    if best <= 0:
        print(">> no piece size worked")
        return
    print(f">> largest piece that worked: {best} bytes")

    print(f"whole photo in pieces of {best}:")
    vendor.apdu(dev, THAI_SELECT)
    started = time.monotonic()
    total = failed = 0
    for offset in range(PHOTO_START, PHOTO_START + PHOTO_LENGTH, best):
        length = min(best, PHOTO_START + PHOTO_LENGTH - offset)
        try:
            total += len(read_piece(vendor, dev, get_response, offset, length)) - 2
        except RuntimeError:
            failed += 1
    print(f">> {total} photo bytes in {time.monotonic() - started:.1f} s, {failed} failed pieces")


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
    parser.add_argument(
        "--trace",
        action="store_true",
        help="only one piece that works (Le 48) and one that fails (Le 32), for a short strace",
    )
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
        atr_bytes = reset_card(vendor, dev)
        print(f"ATR ({len(atr_bytes)} bytes): {atr_bytes.hex(' ').upper()}")

        if args.trace:
            trace_pair(vendor, dev, atr_bytes)
        else:
            ladder(vendor, dev, atr_bytes)
    finally:
        vendor.lib.lc_exit(dev)


if __name__ == "__main__":
    main()
