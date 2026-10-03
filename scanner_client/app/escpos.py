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
# ESC j n — feed backwards n dots (SDK TX_FEED_REV). Kept short: the paper can slip off the roller.
ESC_FEED_REV = b"\x1bj"
MAX_REVERSE_MM = 10
# ESC i — full cut right now. The kiosk3 printer's SDK (TxPrnMod TX_PURECUT_FULL) uses this
# because its GS V cuts are tied to black-mark detection: on plain roll paper GS V B 0 hunted
# for a mark and fed ~17 cm per label. So the label is fed past the cutter explicitly instead.
ESC_CUT = b"\x1bi"
# GS ( F 4 0 a m nL nH — black-mark offset; a = 1 print start, a = 2 cut position.
GS_BLACK_MARK_OFFSET = b"\x1d(F\x04\x00"
BLACK_MARK_CUT = 2
BLACK_MARK_MAX_OFFSET_DOTS = 1500
# GS FF — hunt for the next black mark (SDK TX_CHK_BMARK). GS V B alone does not look for one.
GS_FEED_TO_BLACK_MARK = b"\x1d\x0c"
# GS V B 0 — feed to the cut position set by GS ( F, then cut.
GS_CUT_AT_BLACK_MARK = b"\x1dVB\x00"
DOTS_PER_MM = 8
# Feed before the cut; kiosk3 needs none (it feeds on its own, see CUT_SELF_FEED_MM). If the
# cutter ever clips the bottom line, raise this — it counts toward LABEL_LENGTH_MM, so the
# content shrinks to keep the strip length.
DEFAULT_CUT_FEED_MM = 0
# kiosk3 label: every cut strip is exactly this long, cut to cut (KIOSK_LABEL_MM height).
LABEL_LENGTH_MM = 60
# Paper kiosk3 feeds by itself on ESC i. Measured on 2026-10-02: strip = content + ESC J + 10 mm
# (240 rows + 15 mm -> 55, 360 rows + 15 mm -> 70, 480 rows + 0 -> 70).
CUT_SELF_FEED_MM = 10

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


def align_to_perforation(
    stub_mm: float,
    label_length_mm: int = LABEL_LENGTH_MM,
    self_feed_mm: int = CUT_SELF_FEED_MM,
    trim_mm: float = 0,
) -> bytes:
    """Bring the roll's next perforation to the cutter after paper loading, and cut there.

    On paper load kiosk3 feeds and cuts a stub off on its own, so the cutter ends up mid-label.
    `stub_mm` is the length of that stub when the roll was torn at a perforation before
    loading (or, in general, the distance from the stub's cut edge back to the nearest
    perforation on it). The next perforation is then `label_length_mm - stub_mm % length`
    past the cutter. ESC i adds `self_feed_mm` on its own, so a gap shorter than that skips
    one more label. `trim_mm` corrects what is still off after a run (+ = cut later).
    Returns b"" when the cutter already sits on a perforation.
    """
    if label_length_mm <= self_feed_mm:
        raise ValueError("label_length_mm must be longer than self_feed_mm")
    gap = (label_length_mm - stub_mm % label_length_mm + trim_mm) % label_length_mm
    dots = round(gap * DOTS_PER_MM)
    if dots == 0 or dots == label_length_mm * DOTS_PER_MM:
        return b""
    while dots < self_feed_mm * DOTS_PER_MM:
        dots += label_length_mm * DOTS_PER_MM
    dots -= self_feed_mm * DOTS_PER_MM
    out = bytearray(ESC_INIT)
    while dots > 0:
        step = min(dots, 255)
        out += ESC_FEED + bytes([step])
        dots -= step
    return bytes(out + ESC_CUT)


def cut_strip(length_mm: float, self_feed_mm: int = CUT_SELF_FEED_MM) -> bytes:
    """Cut a strip `length_mm` long off the roll (manual nudging while lining up the cut).

    ESC i feeds `self_feed_mm` on its own, so longer strips feed the rest forward first and
    shorter ones back the paper up first (ESC j; untested on kiosk3, at most MAX_REVERSE_MM).
    """
    dots = round((length_mm - self_feed_mm) * DOTS_PER_MM)
    if length_mm <= 0 or -dots > MAX_REVERSE_MM * DOTS_PER_MM:
        raise ValueError("length_mm is out of range")
    command = ESC_FEED if dots > 0 else ESC_FEED_REV
    out = bytearray(ESC_INIT)
    dots = abs(dots)
    while dots > 0:
        step = min(dots, 255)
        out += command + bytes([step])
        dots -= step
    return bytes(out + ESC_CUT)


def align_to_black_mark(cut_offset_mm: float = 0) -> bytes:
    """Feed to a hand-drawn black mark and cut there (realign after loading a perforated roll).

    The roll has no printed marks, so one is drawn at a perforation before loading; this hunts
    for it with the printer's black-mark sensor and cuts, after which every 60 mm strip lines
    up with the perforations. `cut_offset_mm` moves the cut relative to where the printer
    detects the mark (+ = later). Bytes from the TxPrnMod SDK: TX_SET_BMARK(TX_BM_TEAR) ->
    GS ( F 4 0 2 m nL nH (SDK always sends m = 0; m = 1 for a negative offset is the Epson
    meaning, untested on kiosk3), TX_CHK_BMARK -> GS FF, TX_CUT(TX_CUT_FULL) -> GS V B n.
    GS V B 0 without GS FF cut at the same spot every time on kiosk3, ignoring the mark.
    """
    dots = round(abs(cut_offset_mm) * DOTS_PER_MM)
    if dots > BLACK_MARK_MAX_OFFSET_DOTS:
        raise ValueError("cut_offset_mm is out of range")
    direction = 1 if cut_offset_mm < 0 else 0
    return (
        ESC_INIT
        + GS_BLACK_MARK_OFFSET
        + bytes([BLACK_MARK_CUT, direction])
        + dots.to_bytes(2, "little")
        + GS_FEED_TO_BLACK_MARK
        + GS_CUT_AT_BLACK_MARK
    )


def label_to_escpos(
    png: bytes,
    width_dots: int,
    cut_feed_mm: int = DEFAULT_CUT_FEED_MM,
    label_length_mm: int = 0,
    init: bool = True,
    self_feed_mm: int = 0,
) -> bytes:
    """Render a label PNG as ESC/POS bytes that fit a print head `width_dots` wide.

    Blank margins are trimmed, content wider than the head is scaled down (never up) with
    nearest-neighbour so QR modules stay hard-edged, and the result is centred. The paper is
    then fed `cut_feed_mm` (print head to cutter) and cut.

    Paper advances content + `cut_feed_mm` + `self_feed_mm` (what the printer feeds by itself
    on the cut) between two cuts; the head-to-cutter stretch only moves the content within the
    strip. Measure from the 2nd label: the 1st starts wherever the paper was last cut or torn.
    With `label_length_mm` (0 = content height) every strip is exactly that long: content is
    scaled down to fit or padded with blank rows above and below.

    `init=False` leaves out ESC @ for every label after the first in a batch: the device write
    returns once the printer has the bytes, not once it has cut, so a reset sent straight after
    lands mid-cut and the printer drops that cut — two people came out as one uncut strip.
    """
    if width_dots <= 0 or width_dots % 8:
        raise ValueError("width_dots must be a positive multiple of 8")
    max_rows = (
        (label_length_mm - cut_feed_mm - self_feed_mm) * DOTS_PER_MM if label_length_mm else 0
    )
    if label_length_mm and max_rows <= 0:
        raise ValueError("label_length_mm must be longer than cut_feed_mm + self_feed_mm")

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
