"""Desktop + Start Menu shortcuts that tent.exe makes on its first start (zip build, issue #1326).

Shortcuts are written through the shell's own COM object (IShellLinkW in Windows' signed
shell32/ole32) via ctypes: no extra .pyd for Smart App Control to block, and no PowerShell,
which Smart App Control may put in constrained language mode.
"""

from __future__ import annotations

import ctypes
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path, PurePath

SHORTCUT_NAME = "tent.lnk"
ICON_NAME = "tent.ico"
MARKER_NAME = "shortcuts"
DESCRIPTION = "Read Thai ID cards into the shelter walk-in registration page"

CSIDL_PROGRAMS = 0x02  # per-user Start Menu\Programs
CSIDL_DESKTOPDIRECTORY = 0x10  # follows a OneDrive-redirected Desktop
CSIDL_FLAG_CREATE = 0x8000
MAX_PATH = 260

CLSID_SHELL_LINK = "00021401-0000-0000-C000-000000000046"
IID_ISHELL_LINK_W = "000214F9-0000-0000-C000-000000000046"
IID_IPERSIST_FILE = "0000010B-0000-0000-C000-000000000046"
CLSCTX_INPROC_SERVER = 1

# vtable slots (IUnknown takes 0-2)
QUERY_INTERFACE, RELEASE = 0, 2
SET_DESCRIPTION, SET_WORKING_DIRECTORY, SET_ICON_LOCATION, SET_PATH = 7, 9, 17, 20
PERSIST_SAVE = 6


@dataclass(frozen=True)
class Shortcut:
    path: PurePath
    target: PurePath
    working_dir: PurePath
    icon: PurePath


def ensure_shortcuts(
    exe: PurePath,
    *,
    folders: Iterable[PurePath],
    marker: Path,
    write: Callable[[Shortcut], object],
) -> None:
    """Write a shortcut to `exe` in each folder once per exe path.

    The marker remembers the exe the shortcuts were made for: later starts leave them alone
    (a deleted Desktop shortcut stays deleted), a moved folder gets them rewritten.
    """
    try:
        if marker.read_text(encoding="utf-8") == str(exe):
            return
    except OSError:
        pass
    for folder in folders:
        write(
            Shortcut(
                path=folder / SHORTCUT_NAME,
                target=exe,
                working_dir=exe.parent,
                icon=exe.parent / ICON_NAME,
            )
        )
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(str(exe), encoding="utf-8")


def shortcut_folders() -> list[Path]:
    return [_shell_folder(CSIDL_DESKTOPDIRECTORY), _shell_folder(CSIDL_PROGRAMS)]


def _shell_folder(csidl: int) -> Path:
    buffer = ctypes.create_unicode_buffer(MAX_PATH)
    hr = ctypes.windll.shell32.SHGetFolderPathW(None, csidl | CSIDL_FLAG_CREATE, None, 0, buffer)
    if hr < 0:
        raise OSError(f"SHGetFolderPathW(0x{csidl:x}) failed: 0x{hr & 0xFFFFFFFF:08X}")
    return Path(buffer.value)


def _guid(text: str) -> ctypes.Array[ctypes.c_char]:
    return ctypes.create_string_buffer(uuid.UUID(text).bytes_le, 16)


def _call(obj: ctypes.c_void_p, slot: int, *args: tuple[object, object]) -> None:
    """Call a COM method by vtable slot; ctypes.HRESULT raises OSError on a failure code."""
    vtable = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    prototype = ctypes.WINFUNCTYPE(ctypes.HRESULT, ctypes.c_void_p, *(kind for kind, _ in args))
    prototype(vtable[slot])(obj, *(value for _, value in args))


def _release(obj: ctypes.c_void_p) -> None:
    if obj.value:
        vtable = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtable[RELEASE])(obj)


def save_shortcut(shortcut: Shortcut) -> None:
    ole32 = ctypes.windll.ole32
    initialized = ole32.CoInitialize(None) >= 0  # S_FALSE (already initialized) needs a pair too
    link, persist = ctypes.c_void_p(), ctypes.c_void_p()
    text = ctypes.c_wchar_p
    try:
        hr = ole32.CoCreateInstance(
            _guid(CLSID_SHELL_LINK),
            None,
            CLSCTX_INPROC_SERVER,
            _guid(IID_ISHELL_LINK_W),
            ctypes.byref(link),
        )
        if hr < 0:
            raise OSError(f"CoCreateInstance(ShellLink) failed: 0x{hr & 0xFFFFFFFF:08X}")
        _call(link, SET_PATH, (text, str(shortcut.target)))
        _call(link, SET_WORKING_DIRECTORY, (text, str(shortcut.working_dir)))
        _call(link, SET_ICON_LOCATION, (text, str(shortcut.icon)), (ctypes.c_int, 0))
        _call(link, SET_DESCRIPTION, (text, DESCRIPTION))
        _call(
            link,
            QUERY_INTERFACE,
            (ctypes.c_char_p, _guid(IID_IPERSIST_FILE)),
            (ctypes.c_void_p, ctypes.addressof(persist)),
        )
        _call(persist, PERSIST_SAVE, (text, str(shortcut.path)), (ctypes.c_int, 1))
    finally:
        _release(persist)
        _release(link)
        if initialized:
            ole32.CoUninitialize()
