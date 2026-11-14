"""The two ways a label reaches the USB printer: CUPS `lp` (Linux, the kiosk's way) and the
Windows spooler through GDI+ (no unsigned .pyd for Smart App Control to block)."""

import subprocess

import pytest

from scanner_client.label_printers import (
    CupsPrinter,
    WindowsPrinter,
    fit_on_page,
    label_printer,
)

PNG = b"\x89PNG\r\n\x1a\nlabel"


class FakeRun:
    def __init__(self, returncode=0, error: BaseException | None = None):
        self.returncode = returncode
        self.error = error
        self.calls: list[dict] = []

    def __call__(self, args, **kwargs):
        self.calls.append({"args": args, **kwargs})
        if self.error is not None:
            raise self.error
        return subprocess.CompletedProcess(args, self.returncode)


def test_cups_prints_the_png_from_stdin_at_the_printer_dpi():
    run = FakeRun()

    assert CupsPrinter("tent_xprinter", run=run).print_png(PNG, timeout=20) is True

    call = run.calls[0]
    assert call["args"] == ["lp", "-d", "tent_xprinter", "-t", "tent-label", "-o", "ppi=203", "-"]
    assert call["input"] == PNG  # never a temp file: the label carries a name
    assert call["timeout"] == 20


@pytest.mark.parametrize(
    "run",
    [
        FakeRun(returncode=1),
        FakeRun(error=subprocess.TimeoutExpired("lp", 20)),
        FakeRun(error=FileNotFoundError("lp")),
    ],
    ids=["lp-failed", "timeout", "no-cups"],
)
def test_cups_reports_a_failed_print(run):
    assert CupsPrinter("tent_xprinter", run=run).print_png(PNG, timeout=20) is False


def test_cups_checks_the_queue_exists():
    run = FakeRun()

    assert CupsPrinter("tent_xprinter", run=run).is_installed() is True
    assert run.calls[0]["args"] == ["lpstat", "-p", "tent_xprinter"]

    assert CupsPrinter("tent_xprinter", run=FakeRun(returncode=1)).is_installed() is False
    no_cups = FakeRun(error=FileNotFoundError("lpstat"))
    assert CupsPrinter("tent_xprinter", run=no_cups).is_installed() is False


def test_the_backend_follows_the_platform():
    assert isinstance(label_printer("XP-365B", platform="win32"), WindowsPrinter)
    assert isinstance(label_printer("tent_xprinter", platform="linux"), CupsPrinter)
    assert label_printer("XP-365B", platform="win32").name == "XP-365B"


@pytest.mark.parametrize(
    ("image", "page", "expected"),
    [
        ((639, 479), (639, 479), (0, 0, 639, 479)),  # 80x60 mm label at 203 dpi: 1 px = 1 dot
        ((639, 479), (1278, 958), (0, 0, 1278, 958)),  # a 406 dpi driver: scaled up evenly
        ((639, 479), (639, 600), (0, 60, 639, 479)),  # taller page: centred, never stretched
        ((400, 479), (639, 479), (119, 0, 400, 479)),  # narrower image: centred across
    ],
)
def test_the_label_fills_the_page_keeping_its_shape(image, page, expected):
    assert fit_on_page(*image, *page) == expected


def test_windows_printing_off_windows_fails_instead_of_crashing():
    printer = WindowsPrinter("XP-365B")

    assert printer.is_installed() is False
    assert printer.print_png(PNG, timeout=20) is False
