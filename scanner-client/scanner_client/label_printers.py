"""Send one label PNG to this PC's USB label printer (issue #1326).

Linux: the CUPS queue kiosk/setup_printer.sh makes, through `lp` like the kiosk does; the queue
holds the 80x60 mm label size and gap. Windows: the printer PRINTER.md installs, through
the spooler with GDI+ (Windows' own signed gdiplus/gdi32/winspool via ctypes, so Smart App Control
has no unsigned .pyd to block); its Printing Defaults hold the label size and gap.

Labels go from memory to the printer: never a temp file, since a label carries a name.
"""

from __future__ import annotations

import ctypes
import logging
import subprocess
import sys
from collections.abc import Callable
from typing import Any

# Labels are rendered at the printer's 203 dpi (frontend label-size.ts): 1 image px = 1 dot.
LABEL_PPI = 203
JOB_TITLE = "tent-label"

log = logging.getLogger(__name__)


class CupsPrinter:
    def __init__(self, name: str, *, run: Callable[..., Any] = subprocess.run) -> None:
        self.name = name
        self._run = run

    def _ok(self, args: list[str], **kwargs: Any) -> bool:
        try:
            result = self._run(
                args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, **kwargs
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return result.returncode == 0

    def is_installed(self) -> bool:
        return self._ok(["lpstat", "-p", self.name], timeout=5)

    def print_png(self, png: bytes, timeout: float) -> bool:
        args = ["lp", "-d", self.name, "-t", JOB_TITLE, "-o", f"ppi={LABEL_PPI}", "-"]
        return self._ok(args, input=png, timeout=timeout)


def fit_on_page(image_w: int, image_h: int, page_w: int, page_h: int) -> tuple[int, int, int, int]:
    """(x, y, w, h) that scales the image evenly to fill the page as far as it fits, centred."""
    scale = min(page_w / image_w, page_h / image_h)
    w, h = round(image_w * scale), round(image_h * scale)
    return (page_w - w) // 2, (page_h - h) // 2, w, h


class WindowsPrinter:
    """Prints through the spooler; the label size and gap come from the printer's Printing
    Defaults. A job counts as sent once the spooler has it (the spooler owns the USB timing)."""

    def __init__(self, name: str) -> None:
        self.name = name

    def is_installed(self) -> bool:
        try:
            return _win_printer_exists(self.name)
        except (OSError, AttributeError):  # AttributeError: no ctypes.WinDLL off Windows
            return False

    def print_png(self, png: bytes, timeout: float) -> bool:
        try:
            _win_print_png(self.name, png)
        except (OSError, AttributeError) as exc:
            log.error("label print on %s failed: %s", self.name, exc)
            return False
        return True


def label_printer(name: str, platform: str = sys.platform) -> CupsPrinter | WindowsPrinter:
    return WindowsPrinter(name) if platform == "win32" else CupsPrinter(name)


# --- Windows: winspool / gdi32 / gdiplus through ctypes ---------------------------------------

HORZRES, VERTRES = 8, 10
UNIT_PIXEL = 2
INTERPOLATION_NEAREST_NEIGHBOR = 5  # keep QR modules sharp when the driver's dpi differs
PIXEL_OFFSET_HALF = 4  # pixel centres on whole coordinates: no half-dot shift
ISTREAM_RELEASE = 2


class _GdiplusStartupInput(ctypes.Structure):
    _fields_ = [
        ("GdiplusVersion", ctypes.c_uint32),
        ("DebugEventCallback", ctypes.c_void_p),
        ("SuppressBackgroundThread", ctypes.c_int),
        ("SuppressExternalCodecs", ctypes.c_int),
    ]


class _DocInfoW(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_int),
        ("lpszDocName", ctypes.c_wchar_p),
        ("lpszOutput", ctypes.c_wchar_p),
        ("lpszDatatype", ctypes.c_wchar_p),
        ("fwType", ctypes.c_uint32),
    ]


def _win_printer_exists(name: str) -> bool:
    winspool = ctypes.WinDLL("winspool.drv")
    winspool.OpenPrinterW.argtypes = [
        ctypes.c_wchar_p,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
    ]
    winspool.OpenPrinterW.restype = ctypes.c_int
    winspool.ClosePrinter.argtypes = [ctypes.c_void_p]
    handle = ctypes.c_void_p()
    if not winspool.OpenPrinterW(name, ctypes.byref(handle), None):
        return False
    winspool.ClosePrinter(handle)
    return True


def _gdiplus() -> Any:
    lib = ctypes.WinDLL("gdiplus.dll")
    p, vp = ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)
    signatures = {
        "GdiplusStartup": [
            ctypes.POINTER(ctypes.c_size_t),
            ctypes.POINTER(_GdiplusStartupInput),
            p,
        ],
        "GdipCreateBitmapFromStream": [p, vp],
        "GdipGetImageWidth": [p, ctypes.POINTER(ctypes.c_uint)],
        "GdipGetImageHeight": [p, ctypes.POINTER(ctypes.c_uint)],
        "GdipCreateFromHDC": [p, vp],
        "GdipSetPageUnit": [p, ctypes.c_int],
        "GdipSetInterpolationMode": [p, ctypes.c_int],
        "GdipSetPixelOffsetMode": [p, ctypes.c_int],
        "GdipDrawImageRectI": [p, p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int],
        "GdipDeleteGraphics": [p],
        "GdipDisposeImage": [p],
    }
    for function, argtypes in signatures.items():
        getattr(lib, function).argtypes = argtypes
        getattr(lib, function).restype = ctypes.c_int  # GpStatus, 0 = Ok
    lib.GdiplusShutdown.argtypes = [ctypes.c_size_t]
    lib.GdiplusShutdown.restype = None
    return lib


def _gdi32() -> Any:
    lib = ctypes.WinDLL("gdi32.dll")
    p = ctypes.c_void_p
    lib.CreateDCW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_wchar_p, p]
    lib.CreateDCW.restype = p
    lib.StartDocW.argtypes = [p, ctypes.POINTER(_DocInfoW)]
    for function in ("StartDocW", "StartPage", "EndPage", "EndDoc", "AbortDoc", "DeleteDC"):
        getattr(lib, function).restype = ctypes.c_int
    for function in ("StartPage", "EndPage", "EndDoc", "AbortDoc", "DeleteDC"):
        getattr(lib, function).argtypes = [p]
    lib.GetDeviceCaps.argtypes = [p, ctypes.c_int]
    lib.GetDeviceCaps.restype = ctypes.c_int
    return lib


def _check(function: str, status: int) -> None:
    if status != 0:
        raise OSError(f"{function} failed with GDI+ status {status}")


def _release(com_object: ctypes.c_void_p) -> None:
    if com_object.value:
        vtable = ctypes.cast(com_object, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtable[ISTREAM_RELEASE])(com_object)


def _win_print_png(name: str, png: bytes) -> None:
    gdiplus, gdi32 = _gdiplus(), _gdi32()
    shlwapi = ctypes.WinDLL("shlwapi.dll")
    shlwapi.SHCreateMemStream.argtypes = [ctypes.c_char_p, ctypes.c_uint]
    shlwapi.SHCreateMemStream.restype = ctypes.c_void_p

    token = ctypes.c_size_t()
    startup = _GdiplusStartupInput(GdiplusVersion=1)
    _check(
        "GdiplusStartup", gdiplus.GdiplusStartup(ctypes.byref(token), ctypes.byref(startup), None)
    )
    stream = ctypes.c_void_p(shlwapi.SHCreateMemStream(png, len(png)))
    image, graphics, hdc = ctypes.c_void_p(), ctypes.c_void_p(), None
    started = False
    try:
        if not stream.value:
            raise OSError("SHCreateMemStream failed")
        _check(
            "GdipCreateBitmapFromStream",
            gdiplus.GdipCreateBitmapFromStream(stream, ctypes.byref(image)),
        )
        image_w, image_h = ctypes.c_uint(), ctypes.c_uint()
        _check("GdipGetImageWidth", gdiplus.GdipGetImageWidth(image, ctypes.byref(image_w)))
        _check("GdipGetImageHeight", gdiplus.GdipGetImageHeight(image, ctypes.byref(image_h)))

        hdc = gdi32.CreateDCW("WINSPOOL", name, None, None)  # the printer's Printing Defaults
        if not hdc:
            raise OSError(f"printer {name} could not be opened")
        doc = _DocInfoW(cbSize=ctypes.sizeof(_DocInfoW), lpszDocName=JOB_TITLE)
        if gdi32.StartDocW(hdc, ctypes.byref(doc)) <= 0:
            raise OSError("StartDoc failed")
        started = True
        if gdi32.StartPage(hdc) <= 0:
            raise OSError("StartPage failed")
        page_w, page_h = gdi32.GetDeviceCaps(hdc, HORZRES), gdi32.GetDeviceCaps(hdc, VERTRES)
        x, y, w, h = fit_on_page(image_w.value, image_h.value, page_w, page_h)

        _check("GdipCreateFromHDC", gdiplus.GdipCreateFromHDC(hdc, ctypes.byref(graphics)))
        _check("GdipSetPageUnit", gdiplus.GdipSetPageUnit(graphics, UNIT_PIXEL))
        _check(
            "GdipSetInterpolationMode",
            gdiplus.GdipSetInterpolationMode(graphics, INTERPOLATION_NEAREST_NEIGHBOR),
        )
        _check(
            "GdipSetPixelOffsetMode", gdiplus.GdipSetPixelOffsetMode(graphics, PIXEL_OFFSET_HALF)
        )
        _check("GdipDrawImageRectI", gdiplus.GdipDrawImageRectI(graphics, image, x, y, w, h))
        _check("GdipDeleteGraphics", gdiplus.GdipDeleteGraphics(graphics))
        graphics = ctypes.c_void_p()
        if gdi32.EndPage(hdc) <= 0 or gdi32.EndDoc(hdc) <= 0:
            raise OSError("EndPage/EndDoc failed")
        started = False
    finally:
        if graphics.value:
            gdiplus.GdipDeleteGraphics(graphics)
        if started:
            gdi32.AbortDoc(hdc)
        if hdc:
            gdi32.DeleteDC(hdc)
        if image.value:
            gdiplus.GdipDisposeImage(image)
        _release(stream)
        gdiplus.GdiplusShutdown(token)
