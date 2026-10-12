"""Ctrl+Alt+F1..F6 (switch to a text TTY) for the locked big kiosk (GNOME Kiosk Script session).

On Wayland the compositor owns the keyboard and the kernel does not switch VTs by itself; GNOME
Shell does it on Ctrl+Alt+F<n>, but GNOME Kiosk does not — even with mutter's switch-to-session
keys set (verified on kiosk3 2026-10-03: `sudo chvt 3` works, the keys do nothing). So a
technician with a USB keyboard could not reach a TTY, e.g. to read the new IP address after DHCP
changed it and SSH stopped working.

This daemon reads kernel keyboard events directly (the kiosk user needs the `input` group) and on
Ctrl+Alt+F<n> runs `sudo -n /usr/bin/chvt <n>` (sudoers allows exactly `chvt 1`..`chvt 6`). The
TTY login still asks for user + password; /etc/issue shows hostname + IP above the prompt. Once on
a text TTY the kernel handles Ctrl+Alt+F<n> itself (this daemon then just repeats the same switch).

It runs beside start_kiosk.sh (started by ~/.local/bin/gnome-kiosk-script), so it works even when
main.py/Chromium are down (bootstrap failing = black screen). Devices are never grabbed: Chromium
and the QR reader keep receiving every key. Key codes are never logged — QR scans arrive as keys.
Standard library only, so it runs on the system python3 without the scanner .venv.
"""

from __future__ import annotations

import glob
import logging
import os
import select
import struct
import subprocess
import sys
import time
from typing import Iterator, Optional

# linux/input-event-codes.h
EV_KEY = 1
CTRL_KEYS = frozenset({29, 97})  # KEY_LEFTCTRL, KEY_RIGHTCTRL
ALT_KEYS = frozenset({56, 100})  # KEY_LEFTALT, KEY_RIGHTALT
MODIFIER_KEYS = CTRL_KEYS | ALT_KEYS
# KEY_F1..KEY_F6 are 59..64 -> VT 1..6 (must match the sudoers rule `chvt [1-6]`).
VT_BY_KEY = {59 + index: index + 1 for index in range(6)}
KEY_RELEASE, KEY_PRESS = 0, 1

# struct input_event on 64-bit Linux: struct timeval (two longs), __u16 type, __u16 code, __s32 value.
EVENT_FORMAT = "llHHi"
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)

DEVICE_GLOB = "/dev/input/event*"
# How often to look for newly plugged keyboards (a maintenance keyboard is plugged in on demand).
RESCAN_SEC = 2.0
# Absolute path: it is what /etc/sudoers.d/tent-kiosk-chvt allows.
CHVT = "/usr/bin/chvt"
CHVT_TIMEOUT_SEC = 5.0

logger = logging.getLogger("maintenance_hotkey")


class ComboTracker:
    """Held modifiers of one keyboard; feed() returns the VT number on a Ctrl+Alt+F1..F6 press."""

    def __init__(self) -> None:
        self.held: set[int] = set()

    def feed(self, code: int, value: int) -> Optional[int]:
        if value == KEY_RELEASE:
            self.held.discard(code)
            return None
        if value != KEY_PRESS:
            return None  # autorepeat must not switch again
        if code in MODIFIER_KEYS:
            self.held.add(code)
            return None
        if code in VT_BY_KEY and self.held & CTRL_KEYS and self.held & ALT_KEYS:
            return VT_BY_KEY[code]
        return None


def iter_events(data: bytes) -> Iterator[tuple[int, int, int]]:
    """Yield (type, code, value) for every complete input_event in a read buffer."""
    for offset in range(0, len(data) - EVENT_SIZE + 1, EVENT_SIZE):
        _sec, _usec, ev_type, code, value = struct.unpack_from(EVENT_FORMAT, data, offset)
        yield ev_type, code, value


def chvt_command(vt: int) -> list[str]:
    # -n: never prompt — the daemon has no terminal; a missing sudoers rule fails fast instead.
    return ["sudo", "-n", CHVT, str(vt)]


class HotkeyDaemon:
    def __init__(self) -> None:
        self.devices: dict[str, tuple[int, ComboTracker]] = {}
        self.permission_warned = False

    def rescan(self) -> None:
        for path in sorted(glob.glob(DEVICE_GLOB)):
            if path in self.devices:
                continue
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except PermissionError:
                if not self.permission_warned:
                    logger.error("Cannot read %s: kiosk user is not in the 'input' group "
                                 "(./setup_kiosk_lockdown.sh --restart)", path)
                    self.permission_warned = True
                continue
            except OSError:
                continue
            self.devices[path] = (fd, ComboTracker())

    def drop(self, path: str) -> None:
        fd, _ = self.devices.pop(path)
        try:
            os.close(fd)
        except OSError:
            pass

    def switch_vt(self, vt: int) -> None:
        logger.info("Switching to VT %s", vt)
        try:
            result = subprocess.run(
                chvt_command(vt),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=CHVT_TIMEOUT_SEC,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            logger.exception("chvt %s did not run", vt)
            return
        if result.returncode != 0:
            logger.error("chvt %s failed (sudoers rule missing? ./setup_kiosk_lockdown.sh): %s",
                         vt, result.stderr.strip())

    def poll_once(self, timeout: float) -> None:
        if not self.devices:
            time.sleep(timeout)
            return
        by_fd = {fd: path for path, (fd, _) in self.devices.items()}
        ready, _, _ = select.select(list(by_fd), [], [], timeout)
        for fd in ready:
            path = by_fd[fd]
            try:
                data = os.read(fd, EVENT_SIZE * 64)
            except BlockingIOError:
                continue
            except OSError:  # ENODEV: device unplugged
                self.drop(path)
                continue
            if not data:
                self.drop(path)
                continue
            tracker = self.devices[path][1]
            for ev_type, code, value in iter_events(data):
                if ev_type != EV_KEY:
                    continue
                vt = tracker.feed(code, value)
                if vt is not None:
                    self.switch_vt(vt)

    def run(self) -> None:
        logger.info("VT hotkeys ready: Ctrl+Alt+F1..F6")
        last_scan = float("-inf")
        while True:
            if time.monotonic() - last_scan >= RESCAN_SEC:
                self.rescan()
                last_scan = time.monotonic()
            self.poll_once(RESCAN_SEC)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        HotkeyDaemon().run()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
