"""Maintenance hotkey for the locked big kiosk (GNOME Kiosk Script session).

GNOME Kiosk has no shell, no keybindings and no VT switching (Ctrl+Alt+F3 does nothing), so a
technician with a USB keyboard cannot reach a terminal — e.g. to read the new IP address after
DHCP changed it and SSH stopped working. This daemon reads kernel keyboard events directly
(the kiosk user needs the `input` group) and Ctrl+Alt+Shift+T opens a full-screen terminal running
maintenance_terminal.sh, which shows hostname/IP and asks for the kiosk user's password before
giving a shell.

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
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Iterator, Optional

# linux/input-event-codes.h
EV_KEY = 1
KEY_T = 20
CTRL_KEYS = frozenset({29, 97})  # KEY_LEFTCTRL, KEY_RIGHTCTRL
ALT_KEYS = frozenset({56, 100})  # KEY_LEFTALT, KEY_RIGHTALT
SHIFT_KEYS = frozenset({42, 54})  # KEY_LEFTSHIFT, KEY_RIGHTSHIFT
MODIFIER_KEYS = CTRL_KEYS | ALT_KEYS | SHIFT_KEYS
KEY_RELEASE, KEY_PRESS, KEY_REPEAT = 0, 1, 2

# struct input_event on 64-bit Linux: struct timeval (two longs), __u16 type, __u16 code, __s32 value.
EVENT_FORMAT = "llHHi"
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)

DEVICE_GLOB = "/dev/input/event*"
# How often to look for newly plugged keyboards (a maintenance keyboard is plugged in on demand).
RESCAN_SEC = 2.0
TERMINAL_SCRIPT = Path(__file__).resolve().parent / "maintenance_terminal.sh"
TERMINAL_FONT = "monospace:size=16"

logger = logging.getLogger("maintenance_hotkey")


class ComboTracker:
    """Held modifiers of one keyboard; feed() is True exactly on the Ctrl+Alt+Shift+T press."""

    def __init__(self) -> None:
        self.held: set[int] = set()

    def feed(self, code: int, value: int) -> bool:
        if value == KEY_RELEASE:
            self.held.discard(code)
            return False
        if value != KEY_PRESS:
            return False  # autorepeat must not open a second terminal
        if code in MODIFIER_KEYS:
            self.held.add(code)
            return False
        return (
            code == KEY_T
            and bool(self.held & CTRL_KEYS)
            and bool(self.held & ALT_KEYS)
            and bool(self.held & SHIFT_KEYS)
        )


def iter_events(data: bytes) -> Iterator[tuple[int, int, int]]:
    """Yield (type, code, value) for every complete input_event in a read buffer."""
    for offset in range(0, len(data) - EVENT_SIZE + 1, EVENT_SIZE):
        _sec, _usec, ev_type, code, value = struct.unpack_from(EVENT_FORMAT, data, offset)
        yield ev_type, code, value


def terminal_command(
    script: Path, which: Callable[[str], Optional[str]] = shutil.which
) -> Optional[list[str]]:
    """Command that opens the maintenance terminal, or None when no supported terminal exists."""
    if which("foot"):
        # foot's spawn-terminal (Ctrl+Shift+N) would open a shell without the password; URL launch
        # would start a browser. Both are switched off for this window only.
        return [
            "foot",
            f"--font={TERMINAL_FONT}",
            "--override=key-bindings.spawn-terminal=none",
            "--override=key-bindings.show-urls-launch=none",
            "--",
            str(script),
        ]
    if which("xterm"):
        return ["xterm", "-fa", "Monospace", "-fs", "16", "-e", str(script)]
    return None


class HotkeyDaemon:
    def __init__(self, script: Path = TERMINAL_SCRIPT) -> None:
        self.script = script
        self.devices: dict[str, tuple[int, ComboTracker]] = {}
        self.terminal: Optional[subprocess.Popen] = None
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
                                 "(./setup_kiosk_lockdown.sh, then restart gdm)", path)
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

    def open_terminal(self) -> None:
        if self.terminal and self.terminal.poll() is None:
            logger.info("Maintenance terminal already open")
            return
        command = terminal_command(self.script)
        if command is None:
            logger.error("No terminal emulator (foot/xterm) installed; run ./setup_kiosk_lockdown.sh")
            return
        logger.info("Opening maintenance terminal (%s)", command[0])
        try:
            self.terminal = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError:
            logger.exception("Could not start the maintenance terminal")

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
                if ev_type == EV_KEY and tracker.feed(code, value):
                    self.open_terminal()

    def run(self) -> None:
        logger.info("Maintenance hotkey ready: Ctrl+Alt+Shift+T")
        last_scan = float("-inf")
        while True:
            if time.monotonic() - last_scan >= RESCAN_SEC:
                self.rescan()
                last_scan = time.monotonic()
            self.poll_once(RESCAN_SEC)
            if self.terminal and self.terminal.poll() is not None:
                self.terminal = None  # reaped; the next hotkey may open a new one


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        HotkeyDaemon().run()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
