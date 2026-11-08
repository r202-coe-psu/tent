import io
import logging
import subprocess

import pytest
from PIL import Image, ImageDraw, ImageFont, features

from printer import slip
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


@pytest.fixture
def ttf_engines(monkeypatch):
    """Stands in for a real Thai font: records the layout engine asked for on every truetype call."""
    engines = []
    real_truetype = ImageFont.truetype
    bundled = ImageFont.load_default(12).path.getvalue()  # Pillow's own bundled font bytes

    def fake_truetype(_path, size, *, layout_engine=None, **_kw):
        engines.append(layout_engine)
        return real_truetype(io.BytesIO(bundled), size)

    monkeypatch.setattr(ImageFont, "truetype", fake_truetype)
    return engines


def test_uses_the_raqm_layout_engine_when_pillow_has_it(monkeypatch, ttf_engines, caplog):
    monkeypatch.setattr(features, "check", lambda name, *a, **k: name == "raqm")
    monkeypatch.setattr(slip, "_warned_no_raqm", False)

    with caplog.at_level(logging.WARNING):
        assert render_slip_png(ROWS, ppi=203, font_path="any.ttf") is not None

    assert ttf_engines and set(ttf_engines) == {ImageFont.Layout.RAQM}
    assert "raqm" not in caplog.text.lower()


def test_without_raqm_falls_back_to_basic_layout_and_warns_once(monkeypatch, ttf_engines, caplog):
    monkeypatch.setattr(features, "check", lambda *a, **k: False)
    monkeypatch.setattr(slip, "_warned_no_raqm", False)

    with caplog.at_level(logging.WARNING):
        assert render_slip_png(ROWS, ppi=203, font_path="any.ttf") is not None
        assert render_slip_png(ROWS, ppi=203, font_path="any.ttf") is not None

    assert ttf_engines and set(ttf_engines) == {ImageFont.Layout.BASIC}
    warnings = [r for r in caplog.records if "raqm" in r.getMessage().lower()]
    assert len(warnings) == 1
    assert "libraqm" in warnings[0].getMessage()


@pytest.fixture
def drawn_text(monkeypatch, ttf_engines):
    """Every string the slip draws, in order."""
    texts = []
    original = ImageDraw.ImageDraw.text

    def recording_text(self, xy, text, *args, **kwargs):
        texts.append(text)
        return original(self, xy, text, *args, **kwargs)

    monkeypatch.setattr(ImageDraw.ImageDraw, "text", recording_text)
    return texts


def test_long_value_wraps_onto_extra_lines_instead_of_being_cut(drawn_text):
    value = "ABCDEFGHIJ" * 20  # too wide for one line even at the 12px floor

    assert render_slip_png([("Name", value)], ppi=203, font_path="any.ttf") is not None

    assert drawn_text[0] == "Name"
    assert len(drawn_text) > 2  # label + more than one value line
    assert "".join(drawn_text[1:]) == value


def test_text_that_cannot_fit_even_wrapped_ends_with_an_ellipsis(drawn_text):
    value = "ABCDEFGHIJ" * 500

    assert render_slip_png([("Name", value)], ppi=203, font_path="any.ttf") is not None

    assert drawn_text[-1].endswith("\u2026")
    assert len("".join(drawn_text[1:])) < len(value)


def test_wrapping_never_splits_a_thai_mark_from_its_consonant(drawn_text):
    value = "กิ" * 300  # consonant + vowel mark pairs

    assert render_slip_png([("Name", value)], ppi=203, font_path="any.ttf") is not None

    assert len(drawn_text) > 2
    assert all(not line.startswith("\u0e34") for line in drawn_text[1:])
