"""Pure PNG label -> ESC/POS raster conversion for the kiosk's built-in thermal printer."""

from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

ESC_INIT = b"\x1b@"
# GS v 0 m xL xH yL yH d1..dk — raster bit image, normal density (m = 0).
GS_RASTER = b"\x1dv0\x00"
# GS V B 0 — feed to the cutting position, then full cut.
GS_FEED_CUT = b"\x1dVB\x00"

THRESHOLD = 128
# Printers with small buffers (GD32 class) drop long raster blocks, so images go out in bands.
MAX_BAND_ROWS = 255


def _load_ink_mask(png: bytes) -> Image.Image:
    """1-bit-valued 'L' image: 255 where a dot is printed (dark), 0 elsewhere."""
    try:
        with Image.open(io.BytesIO(png)) as source:
            source.load()
            rgba = source.convert("RGBA")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as error:
        raise ValueError("label image is not a readable PNG") from error
    # Transparent pixels must read as paper, not as black.
    page = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    page.alpha_composite(rgba)
    gray = page.convert("L")
    return gray.point(lambda value: 255 if value < THRESHOLD else 0)


def label_to_escpos(png: bytes, width_dots: int) -> bytes:
    """Render a label PNG as ESC/POS bytes that fit a print head `width_dots` wide.

    Blank margins are trimmed, content wider than the head is scaled down (never up) with
    nearest-neighbour so QR modules stay hard-edged, and the result is centred.
    """
    if width_dots <= 0 or width_dots % 8:
        raise ValueError("width_dots must be a positive multiple of 8")

    ink = _load_ink_mask(png)
    box = ink.getbbox()
    if box is None:
        raise ValueError("label image has no printable content")
    content = ink.crop(box)

    if content.width > width_dots:
        height = max(1, round(content.height * width_dots / content.width))
        content = content.resize((width_dots, height), Image.NEAREST)

    canvas = Image.new("L", (width_dots, content.height), 0)
    canvas.paste(content, ((width_dots - content.width) // 2, 0))
    # PIL packs mode "1" MSB-first with 1 = white; ESC/POS wants 1 = printed dot, which is
    # exactly the ink mask (255 -> bit 1), so pack the mask directly.
    packed = canvas.convert("1", dither=Image.Dither.NONE)
    row_bytes = width_dots // 8
    raster = packed.tobytes()

    out = bytearray(ESC_INIT)
    for top in range(0, canvas.height, MAX_BAND_ROWS):
        rows = min(MAX_BAND_ROWS, canvas.height - top)
        out += GS_RASTER
        out += row_bytes.to_bytes(2, "little") + rows.to_bytes(2, "little")
        out += raster[top * row_bytes : (top + rows) * row_bytes]
    out += GS_FEED_CUT
    return bytes(out)
