"""tent.exe makes its own Desktop + Start Menu shortcuts (with tent.ico) on its first start, so
the zip build needs no installer and no PowerShell (Smart App Control may constrain it)."""

from pathlib import PureWindowsPath

from scanner_client.shortcuts import Shortcut, ensure_shortcuts

TENT = PureWindowsPath(r"C:\Users\staff\AppData\Local\Programs\tent\tent.exe")
DESKTOP = PureWindowsPath(r"C:\Users\staff\OneDrive\Desktop")
PROGRAMS = PureWindowsPath(r"C:\Users\staff\AppData\Roaming\Microsoft\Windows\Start Menu\Programs")


def _ensure(exe, marker, written):
    ensure_shortcuts(exe, folders=[DESKTOP, PROGRAMS], marker=marker, write=written.append)


def test_first_start_makes_a_tent_shortcut_in_every_folder(tmp_path):
    written = []

    _ensure(TENT, tmp_path / "shortcuts", written)

    assert written == [
        Shortcut(
            path=folder / "tent.lnk",
            target=TENT,
            working_dir=TENT.parent,
            icon=TENT.parent / "tent.ico",
        )
        for folder in (DESKTOP, PROGRAMS)
    ]


def test_later_starts_leave_the_shortcuts_alone(tmp_path):
    # staff who deleted the Desktop shortcut on purpose must not get it back every start
    marker = tmp_path / "shortcuts"
    _ensure(TENT, marker, [])
    written = []

    _ensure(TENT, marker, written)

    assert written == []


def test_a_moved_folder_points_the_shortcuts_at_the_new_tent_exe(tmp_path):
    marker = tmp_path / "shortcuts"
    _ensure(TENT, marker, [])
    moved = PureWindowsPath(r"D:\tent\tent.exe")
    written = []

    _ensure(moved, marker, written)

    assert [shortcut.target for shortcut in written] == [moved, moved]


def test_a_failed_write_is_retried_next_start(tmp_path):
    marker = tmp_path / "shortcuts"

    def fail(shortcut):
        raise OSError("access denied")

    try:
        ensure_shortcuts(TENT, folders=[DESKTOP], marker=marker, write=fail)
    except OSError:
        pass
    written = []
    _ensure(TENT, marker, written)

    assert len(written) == 2


def test_the_marker_folder_is_created(tmp_path):
    marker = tmp_path / "ScannerClient" / "shortcuts"

    _ensure(TENT, marker, [])

    assert marker.read_text(encoding="utf-8") == str(TENT)
