"""Boot slip drawn as a 1-bit PNG: CUPS' text filter has no Thai glyphs and no mark placement."""

import io
import logging
import subprocess
import unicodedata

_MM_PER_INCH = 25.4
_WIDTH_MM = 80
_HEIGHT_MM = 60
# Thai fonts that read well on a thermal head, best first; any other Thai font is the fallback.
_PREFERRED = ("Loma", "Garuda", "Sarabun", "NotoSansThai", "Norasi", "Kinnari")
_ELLIPSIS = "\u2026"
_MIN_SIZE = 12
_LEADING_VOWELS = "\u0e40\u0e41\u0e42\u0e43\u0e44"  # เ แ โ ใ ไ: written before their consonant

_log = logging.getLogger("printer")
_warned_no_raqm = False


def _layout_engine(image_font):
    """RAQM places Thai vowel/tone marks correctly; BASIC leaves them misplaced, so say so once."""
    global _warned_no_raqm
    from PIL import features

    if features.check("raqm"):
        return image_font.Layout.RAQM
    if not _warned_no_raqm:
        _warned_no_raqm = True
        _log.warning(
            "Pillow has no libraqm: Thai vowel/tone marks on the boot slip will be misplaced "
            "- sudo apt-get install -y libraqm0 libfribidi0, then restart the agent"
        )
    return image_font.Layout.BASIC


def _wrap(text: str, font, max_width: float) -> list[str]:
    """Greedy character wrap (Thai has no spaces); never parts a mark or a leading vowel."""
    lines: list[str] = []
    current = ""
    for char in text:
        splittable = (
            current
            and unicodedata.category(char) != "Mn"
            and current[-1] not in _LEADING_VOWELS
        )
        if splittable and font.getlength(current + char) > max_width:
            lines.append(current)
            current = ""
            if char.isspace():
                continue
        current += char
    if current:
        lines.append(current)
    return lines or [""]


def _ellipsize(text: str, font, max_width: float) -> str:
    while text and font.getlength(text + _ELLIPSIS) > max_width:
        text = text[:-1]
        while text and unicodedata.category(text[-1]) == "Mn":  # keep marks with their base
            text = text[:-1]
    return text + _ELLIPSIS


def find_thai_font() -> str | None:
    """Path of an installed font covering Thai, via fontconfig; None if there is none."""
    try:
        listing = subprocess.run(
            ["fc-list", ":lang=th", "file"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    paths = sorted({line.strip().rstrip(":") for line in listing.splitlines() if line.strip()})
    for family in _PREFERRED:
        for path in paths:
            name = path.rsplit("/", 1)[-1]
            if name.startswith(family) and "Bold" not in name and "Oblique" not in name:
                return path
    return paths[0] if paths else None


def render_slip_png(rows: list[tuple[str, str]], ppi: int, font_path: str | None) -> bytes | None:
    """One 80x60 mm label: `label  value` per row, shrunk to fit. None if it cannot be drawn."""
    if font_path is None:
        return None
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None

    width = int(_WIDTH_MM / _MM_PER_INCH * ppi)
    height = int(_HEIGHT_MM / _MM_PER_INCH * ppi)
    margin = width // 20
    engine = _layout_engine(ImageFont)
    try:
        size = max(_MIN_SIZE, height // (len(rows) + 2))
        while True:
            font = ImageFont.truetype(font_path, size, layout_engine=engine)
            label_col = max((font.getlength(label) for label, _ in rows), default=0)
            gap = size // 2 if label_col else 0
            widest = max(label_col + gap + font.getlength(value) for _, value in rows)
            line = int(size * 1.5)
            if (widest <= width - 2 * margin and line * len(rows) <= height - 2 * margin) or (
                size <= _MIN_SIZE
            ):
                break
            size -= 1
    except OSError:
        return None

    # Lay out as lines of (x, text) pieces. What still does not fit at the smallest size wraps;
    # what does not fit even wrapped ends with an ellipsis rather than being cut silently.
    right = width - margin
    lines: list[list[tuple[int, str]]] = []
    for label, value in rows:
        x = margin + label_col + gap if label else margin  # a heading spans the whole line
        pieces = _wrap(value, font, right - x)
        for index, piece in enumerate(pieces):
            first = [(margin, label)] if label and index == 0 else []
            lines.append([*first, (x, piece)])
    max_lines = max(1, (height - 2 * margin) // line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        x, text = lines[-1][-1]
        lines[-1][-1] = (x, _ellipsize(text, font, right - x))

    image = Image.new("1", (width, height), 1)
    draw = ImageDraw.Draw(image)
    y = margin
    for pieces in lines:
        for x, text in pieces:
            draw.text((x, y), text, font=font, fill=0)
        y += line
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()
