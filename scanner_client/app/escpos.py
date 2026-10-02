"""Pure PNG label -> ESC/POS raster conversion for the kiosk's built-in thermal printer."""

from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

# ESC @ resets the printer; FS . leaves Chinese (Kanji) character mode, which kiosk printers
# often power up in — so any stray byte prints as a single character, not as Chinese glyphs.
ESC_INIT = b"\x1b@\x1c."
# GS v 0 m xL xH yL yH d1..dk — raster bit image, normal density (m = 0).
GS_RASTER = b"\x1dv0\x00"
# ESC J n — feed n dots (1 dot = 0.125 mm at 203 dpi), n <= 255 per command.
ESC_FEED = b"\x1bJ"
# ESC i — full cut right now. The kiosk3 printer's SDK (TxPrnMod TX_PURECUT_FULL) uses this
# because its GS V cuts are tied to black-mark detection: on plain roll paper GS V B 0 hunted
# for a mark and fed ~17 cm per label. So the label is fed past the cutter explicitly instead.
ESC_CUT = b"\x1bi"
DOTS_PER_MM = 8
# Print-head-to-cutter distance on kiosk3; PRINTER_CUT_FEED_MM overrides it per printer model.
DEFAULT_CUT_FEED_MM = 15
# kiosk3 label: every cut strip is exactly this long, cut to cut (KIOSK_LABEL_MM height).
LABEL_LENGTH_MM = 60
# Paper kiosk3 feeds on its own around ESC i: a 60 mm strip measured 75 mm before this was
# subtracted. Re-measure (strip length - LABEL_LENGTH_MM) if PRINTER_CUT_FEED_MM changes.
CUT_EXTRA_MM = 15

THRESHOLD = 128
# Labels are ~640x480 px. A tiny PNG can still declare a huge canvas (decompression bomb), so
# the size is checked from the header before any pixel data is decoded.
MAX_LABEL_PIXELS = 4_000_000
# Printers with small buffers (GD32 class) drop long raster blocks, so images go out in bands.
MAX_BAND_ROWS = 255


def _load_ink_mask(png: bytes) -> Image.Image:
    """1-bit-valued 'L' image: 255 where a dot is printed (dark), 0 elsewhere."""
    try:
        with Image.open(io.BytesIO(png)) as source:
            if source.width * source.height > MAX_LABEL_PIXELS:
                raise ValueError("label image is too large")
            source.load()
            rgba = source.convert("RGBA")
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        ValueError,
    ) as error:
        raise ValueError("label image is not a readable PNG") from error
    # Transparent pixels must read as paper, not as black.
    page = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    page.alpha_composite(rgba)
    gray = page.convert("L")
    return gray.point(lambda value: 255 if value < THRESHOLD else 0)


def feed_and_cut(cut_feed_mm: int) -> bytes:
    """Feed the last printed row past the cutter, then cut (independent of black-mark mode)."""
    out = bytearray()
    dots = cut_feed_mm * DOTS_PER_MM
    while dots > 0:
        step = min(dots, 255)
        out += ESC_FEED + bytes([step])
        dots -= step
    return bytes(out + ESC_CUT)


def label_to_escpos(
    png: bytes,
    width_dots: int,
    cut_feed_mm: int = DEFAULT_CUT_FEED_MM,
    label_length_mm: int = 0,
    init: bool = True,
    cut_extra_mm: int = 0,
) -> bytes:
    """Render a label PNG as ESC/POS bytes that fit a print head `width_dots` wide.

    Blank margins are trimmed, content wider than the head is scaled down (never up) with
    nearest-neighbour so QR modules stay hard-edged, and the result is centred. The paper is
    then fed `cut_feed_mm` (print head to cutter) and cut.

    Paper advances content + `cut_feed_mm` + `cut_extra_mm` between two cuts (the head-to-cutter
    stretch only moves the content within the strip). `cut_extra_mm` is what the printer feeds
    on its own around the cut — measured strip length minus the expected one; kiosk3 adds ~15 mm.
    With `label_length_mm` (0 = content height) every strip is exactly that long: content is
    scaled down to fit or padded with blank rows above and below.

    `init=False` leaves out ESC @ for every label after the first in a batch: the device write
    returns once the printer has the bytes, not once it has cut, so a reset sent straight after
    lands mid-cut and the printer drops that cut — two people came out as one uncut strip.
    """
    if width_dots <= 0 or width_dots % 8:
        raise ValueError("width_dots must be a positive multiple of 8")
    max_rows = (
        (label_length_mm - cut_feed_mm - cut_extra_mm) * DOTS_PER_MM if label_length_mm else 0
    )
    if label_length_mm and max_rows <= 0:
        raise ValueError("label_length_mm must be longer than cut_feed_mm + cut_extra_mm")

    ink = _load_ink_mask(png)
    box = ink.getbbox()
    if box is None:
        raise ValueError("label image has no printable content")
    content = ink.crop(box)

    if content.width > width_dots:
        height = max(1, round(content.height * width_dots / content.width))
        content = content.resize((width_dots, height), Image.NEAREST)
    if max_rows and content.height > max_rows:
        width = max(1, round(content.width * max_rows / content.height))
        content = content.resize((width, max_rows), Image.NEAREST)

    canvas = Image.new("L", (width_dots, max_rows or content.height), 0)
    canvas.paste(
        content, ((width_dots - content.width) // 2, (canvas.height - content.height) // 2)
    )
    # PIL packs mode "1" MSB-first with 1 = white; ESC/POS wants 1 = printed dot, which is
    # exactly the ink mask (255 -> bit 1), so pack the mask directly.
    packed = canvas.convert("1", dither=Image.Dither.NONE)
    row_bytes = width_dots // 8
    raster = packed.tobytes()

    out = bytearray(ESC_INIT if init else b"")
    for top in range(0, canvas.height, MAX_BAND_ROWS):
        rows = min(MAX_BAND_ROWS, canvas.height - top)
        out += GS_RASTER
        out += row_bytes.to_bytes(2, "little") + rows.to_bytes(2, "little")
        out += raster[top * row_bytes : (top + rows) * row_bytes]
    out += feed_and_cut(cut_feed_mm)
    return bytes(out)
