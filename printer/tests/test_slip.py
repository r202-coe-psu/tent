import io
import subprocess

import pytest
from PIL import Image

from printer.slip import find_thai_font, render_slip_png

ROWS = [
    ("", "TENT PRINT AGENT"),
    ("Name", "เครื่องพิมพ์ จุดลงทะเบียน 1"),
    ("Device", "printer-sh001-reg1"),
    ("IP", "192.168.1.50"),
]


def thai_font_or_skip() -> str:
    font = find_thai_font()
    if font is None:
        pytest.skip("no Thai font installed (apt install fonts-thai-tlwg)")
    return font


def test_renders_one_80x60mm_1bit_png_at_the_given_ppi():
    png = render_slip_png(ROWS, ppi=203, font_path=thai_font_or_skip())

    assert png is not None
    image = Image.open(io.BytesIO(png))
    assert (image.format, image.mode, image.size) == ("PNG", "1", (639, 479))


def test_size_follows_ppi():
    png = render_slip_png(ROWS, ppi=300, font_path=thai_font_or_skip())

    assert png is not None
    assert Image.open(io.BytesIO(png)).size == (944, 708)


def test_slip_has_ink():
    png = render_slip_png(ROWS, ppi=203, font_path=thai_font_or_skip())

    assert png is not None
    image = Image.open(io.BytesIO(png))
    assert image.getextrema() == (0, 255)


def test_very_long_name_still_renders():
    rows = [("Name", "ศูนย์พักพิงชั่วคราว " * 10)]

    assert render_slip_png(rows, ppi=203, font_path=thai_font_or_skip()) is not None


def test_no_font_gives_none():
    assert render_slip_png(ROWS, ppi=203, font_path=None) is None


def test_unreadable_font_gives_none(tmp_path):
    broken = tmp_path / "broken.ttf"
    broken.write_bytes(b"not a font")

    assert render_slip_png(ROWS, ppi=203, font_path=str(broken)) is None


def test_find_thai_font_prefers_a_listed_family(monkeypatch):
    listing = "/fonts/Purisa.ttf\n/fonts/tlwg/Loma.ttf\n/fonts/Kanit-Black.ttf\n"
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=listing, stderr=""),
    )

    assert find_thai_font() == "/fonts/tlwg/Loma.ttf"


def test_find_thai_font_falls_back_to_any_thai_font(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout="/fonts/Purisa.ttf\n", stderr=""),
    )

    assert find_thai_font() == "/fonts/Purisa.ttf"


@pytest.mark.parametrize("error", [FileNotFoundError, subprocess.TimeoutExpired("fc-list", 5)])
def test_find_thai_font_is_none_without_fontconfig(monkeypatch, error):
    def boom(*_a, **_k):
        raise error

    monkeypatch.setattr(subprocess, "run", boom)

    assert find_thai_font() is None


def test_find_thai_font_is_none_when_nothing_covers_thai(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout="", stderr=""),
    )

    assert find_thai_font() is None
