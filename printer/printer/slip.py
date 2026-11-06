"""Boot slip drawn as a 1-bit PNG: CUPS' text filter has no Thai glyphs and no mark placement."""

import io
import subprocess

_MM_PER_INCH = 25.4
_WIDTH_MM = 80
_HEIGHT_MM = 60
# Thai fonts that read well on a thermal head, best first; any other Thai font is the fallback.
_PREFERRED = ("Loma", "Garuda", "Sarabun", "NotoSansThai", "Norasi", "Kinnari")


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
    try:
        size = max(12, height // (len(rows) + 2))
        while True:
            font = ImageFont.truetype(font_path, size)
            label_col = max((font.getlength(label) for label, _ in rows), default=0)
            gap = size // 2 if label_col else 0
            widest = max(label_col + gap + font.getlength(value) for _, value in rows)
            line = int(size * 1.5)
            if (widest <= width - 2 * margin and line * len(rows) <= height - 2 * margin) or (
                size <= 12
            ):
                break
            size -= 1
    except OSError:
        return None

    image = Image.new("1", (width, height), 1)
    draw = ImageDraw.Draw(image)
    y = margin
    for label, value in rows:
        if label:
            draw.text((margin, y), label, font=font, fill=0)
            draw.text((margin + label_col + gap, y), value, font=font, fill=0)
        else:  # a heading spans the whole line
            draw.text((margin, y), value, font=font, fill=0)
        y += line
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()
