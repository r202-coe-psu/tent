import io
import unittest

from PIL import Image

from app.escpos import (
    DEFAULT_CUT_FEED_MM,
    ESC_CUT,
    ESC_FEED,
    ESC_INIT,
    GS_RASTER,
    MAX_LABEL_PIXELS,
    align_to_black_mark,
    align_to_perforation,
    cut_strip,
    feed_and_cut,
    label_to_escpos,
)

DEFAULT_TAIL = feed_and_cut(DEFAULT_CUT_FEED_MM)


def png_of(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def block_png(canvas_size, box):
    """White canvas with a black rectangle at `box` (left, top, right, bottom)."""
    image = Image.new("RGB", canvas_size, "white")
    image.paste("black", box)
    return png_of(image)


def parse_bands(data: bytes):
    """Split label_to_escpos output into (row_bytes, rows, payload) bands."""
    assert data.startswith(ESC_INIT) and data.endswith(DEFAULT_TAIL)
    body = data[len(ESC_INIT) : -len(DEFAULT_TAIL)]
    bands = []
    while body:
        assert body.startswith(GS_RASTER), body[:8]
        row_bytes = int.from_bytes(body[4:6], "little")
        rows = int.from_bytes(body[6:8], "little")
        size = row_bytes * rows
        bands.append((row_bytes, rows, body[8 : 8 + size]))
        body = body[8 + size :]
    return bands


def row_bits(payload: bytes, row_bytes: int, row: int) -> str:
    chunk = payload[row * row_bytes : (row + 1) * row_bytes]
    return "".join(f"{byte:08b}" for byte in chunk)


class LabelToEscposTests(unittest.TestCase):
    def test_band_header_matches_width_and_trimmed_height(self):
        data = label_to_escpos(block_png((640, 480), (20, 30, 220, 130)), 576)

        bands = parse_bands(data)

        self.assertTrue(all(row_bytes == 576 // 8 for row_bytes, _, _ in bands))
        self.assertEqual(sum(rows for _, rows, _ in bands), 100)

    def test_narrow_content_is_trimmed_not_scaled_and_centred(self):
        data = label_to_escpos(block_png((640, 100), (40, 10, 600, 90)), 576)

        ((row_bytes, rows, payload),) = parse_bands(data)

        self.assertEqual(rows, 80)
        bits = row_bits(payload, row_bytes, 0)
        # 560 dots of ink centred in 576: 8 blank dots each side.
        self.assertEqual(bits, "0" * 8 + "1" * 560 + "0" * 8)

    def test_wide_content_is_scaled_down_keeping_aspect_ratio(self):
        data = label_to_escpos(block_png((640, 400), (16, 0, 624, 304)), 576)

        bands = parse_bands(data)

        # 608x304 -> 576x288 (same ratio on both axes).
        self.assertEqual(sum(rows for _, rows, _ in bands), 288)
        _, _, payload = bands[0]
        self.assertEqual(row_bits(payload, 576 // 8, 0), "1" * 576)

    def test_label_length_scales_tall_content_down_keeping_aspect_ratio(self):
        # 60 mm strip, no ESC J feed = 480 rows for the content.
        data = label_to_escpos(block_png((640, 800), (0, 0, 576, 768)), 576, label_length_mm=60)

        bands = parse_bands(data)

        self.assertEqual(sum(rows for _, rows, _ in bands), 480)
        # 576x768 -> 360x480, centred: 108 blank dots each side.
        self.assertEqual(row_bits(bands[0][2], 72, 0), "0" * 108 + "1" * 360 + "0" * 108)

    def test_label_length_includes_the_feed_before_the_cut(self):
        # 60 mm strip - 15 mm ESC J feed = 45 mm = 360 rows for the content.
        data = label_to_escpos(
            block_png((640, 800), (0, 0, 576, 768)), 576, cut_feed_mm=15, label_length_mm=60
        )

        self.assertTrue(data.endswith(feed_and_cut(15)))
        body = data[len(ESC_INIT) : -len(feed_and_cut(15))]
        self.assertEqual(body.count(GS_RASTER), 2)  # 255 + 105 rows
        self.assertEqual(int.from_bytes(body[6:8], "little"), 255)

    def test_label_length_pads_short_content_so_every_strip_is_exactly_that_long(self):
        data = label_to_escpos(block_png((640, 480), (0, 0, 576, 200)), 576, label_length_mm=60)

        bands = parse_bands(data)
        payload = b"".join(band for _, _, band in bands)

        self.assertEqual(sum(rows for _, rows, _ in bands), 480)
        # 200 ink rows centred in 480: 140 blank rows above and below.
        self.assertEqual(row_bits(payload, 72, 139), "0" * 576)
        self.assertEqual(row_bits(payload, 72, 140), "1" * 576)
        self.assertEqual(row_bits(payload, 72, 339), "1" * 576)
        self.assertEqual(row_bits(payload, 72, 340), "0" * 576)

    def test_label_length_leaves_room_for_what_the_printer_feeds_itself(self):
        # kiosk3 feeds 10 mm by itself on ESC i: 60 - 10 = 50 mm = 400 rows for the content.
        data = label_to_escpos(
            block_png((640, 800), (0, 0, 576, 768)), 576, label_length_mm=60, self_feed_mm=10
        )

        self.assertEqual(sum(rows for _, rows, _ in parse_bands(data)), 400)
        self.assertTrue(data.endswith(ESC_CUT))

    def test_zero_label_length_keeps_the_trimmed_content_height(self):
        data = label_to_escpos(block_png((640, 480), (0, 0, 576, 432)), 576)

        self.assertEqual(sum(rows for _, rows, _ in parse_bands(data)), 432)

    def test_label_length_must_exceed_the_cut_feed(self):
        with self.assertRaises(ValueError):
            label_to_escpos(block_png((64, 64), (0, 0, 32, 32)), 576, cut_feed_mm=15, label_length_mm=15)

    def test_later_labels_in_a_batch_skip_the_reset_but_keep_feed_and_cut(self):
        png = block_png((64, 64), (0, 0, 32, 32))

        first = label_to_escpos(png, 576)
        later = label_to_escpos(png, 576, init=False)

        self.assertEqual(first, ESC_INIT + later)
        self.assertTrue(later.startswith(GS_RASTER))
        self.assertTrue(later.endswith(DEFAULT_TAIL))

    def test_tall_image_is_split_into_bands_of_at_most_255_rows(self):
        data = label_to_escpos(block_png((100, 600), (0, 0, 100, 600)), 576)

        bands = parse_bands(data)

        self.assertEqual([rows for _, rows, _ in bands], [255, 255, 90])
        self.assertTrue(data.endswith(DEFAULT_TAIL))

    def test_label_ends_with_a_black_mark_independent_feed_and_cut(self):
        # GS V cuts follow black-mark detection on the kiosk3 printer and fed ~17 cm per label.
        data = label_to_escpos(block_png((64, 64), (0, 0, 32, 32)), 576, cut_feed_mm=15)

        self.assertTrue(data.endswith(ESC_FEED + bytes([120]) + ESC_CUT))
        self.assertNotIn(b"\x1dV", data[-8:])

    def test_feed_longer_than_255_dots_is_split_and_zero_feed_only_cuts(self):
        self.assertEqual(feed_and_cut(40), ESC_FEED + b"\xff" + ESC_FEED + bytes([65]) + ESC_CUT)
        self.assertEqual(feed_and_cut(0), ESC_CUT)

    def test_transparent_pixels_are_paper_not_ink(self):
        image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        image.paste((0, 0, 0, 255), (8, 8, 24, 24))

        ((_, rows, payload),) = parse_bands(label_to_escpos(png_of(image), 576))

        self.assertEqual(rows, 16)
        self.assertEqual(row_bits(payload, 72, 0).count("1"), 16)

    def test_unreadable_or_blank_images_raise_value_error(self):
        blank = png_of(Image.new("RGB", (64, 64), "white"))
        for name, png in {"garbage": b"\x89PNG\r\n\x1a\nnope", "blank": blank}.items():
            with self.subTest(name=name), self.assertRaises(ValueError):
                label_to_escpos(png, 576)

    def test_oversized_canvases_are_rejected_before_decoding(self):
        # 3000x2400 = 7.2M px: over our cap but under Pillow's own bomb limit.
        # 14000x14000 compresses to ~50 KB yet declares 196M px: Pillow raises DecompressionBombError.
        for name, size in {"over cap": (3000, 2400), "bomb": (14000, 14000)}.items():
            with self.subTest(name=name):
                self.assertGreater(size[0] * size[1], MAX_LABEL_PIXELS)
                with self.assertRaises(ValueError):
                    label_to_escpos(png_of(Image.new("1", size, 1)), 576)

    def test_width_must_be_a_positive_multiple_of_eight(self):
        png = block_png((64, 64), (0, 0, 32, 32))
        for width in (0, 100, -8):
            with self.subTest(width=width), self.assertRaises(ValueError):
                label_to_escpos(png, width)


def fed_dots(data: bytes) -> int:
    """Total ESC J feed in an init + feeds + cut job."""
    assert data.startswith(ESC_INIT) and data.endswith(ESC_CUT)
    body = data[len(ESC_INIT) : -len(ESC_CUT)]
    total = 0
    while body:
        assert body.startswith(ESC_FEED), body[:4]
        total += body[2]
        body = body[3:]
    return total


class AlignToPerforationTests(unittest.TestCase):
    def test_feeds_to_next_perforation_minus_the_cut_self_feed(self):
        # 23 mm stub -> perforation 37 mm past the cutter; ESC i adds 10 mm itself.
        data = align_to_perforation(23, label_length_mm=60, self_feed_mm=10)

        self.assertEqual(fed_dots(data), 27 * 8)

    def test_stub_longer_than_a_label_uses_the_remainder(self):
        data = align_to_perforation(83, label_length_mm=60, self_feed_mm=10)

        self.assertEqual(fed_dots(data), 27 * 8)

    def test_gap_shorter_than_self_feed_skips_one_more_label(self):
        # 55 mm stub -> perforation 5 mm away, but ESC i alone moves 10 mm: go to the next one.
        data = align_to_perforation(55, label_length_mm=60, self_feed_mm=10)

        self.assertEqual(fed_dots(data), 55 * 8)

    def test_trim_shifts_the_cut(self):
        data = align_to_perforation(23, label_length_mm=60, self_feed_mm=10, trim_mm=-2)

        self.assertEqual(fed_dots(data), 25 * 8)

    def test_already_on_a_perforation_sends_nothing(self):
        for stub in (0, 60, 120):
            with self.subTest(stub=stub):
                self.assertEqual(align_to_perforation(stub, label_length_mm=60), b"")

    def test_label_must_be_longer_than_self_feed(self):
        with self.assertRaises(ValueError):
            align_to_perforation(10, label_length_mm=10, self_feed_mm=10)


class AlignToBlackMarkTests(unittest.TestCase):
    def test_sets_cut_offset_then_cuts_at_the_mark(self):
        data = align_to_black_mark(3)

        # ESC @ FS . | GS ( F 4 0 a=2 m=0 24 dots | GS FF | GS V B 0
        self.assertEqual(
            data,
            ESC_INIT + b"\x1d(F\x04\x00\x02\x00\x18\x00" + b"\x1d\x0c" + b"\x1dVB\x00",
        )

    def test_negative_offset_cuts_before_the_mark(self):
        data = align_to_black_mark(-2.5)

        self.assertIn(b"\x1d(F\x04\x00\x02\x01\x14\x00", data)

    def test_offset_beyond_printer_range_is_rejected(self):
        with self.assertRaises(ValueError):
            align_to_black_mark(200)


class CutStripTests(unittest.TestCase):
    def test_strip_as_long_as_the_self_feed_is_a_bare_cut(self):
        self.assertEqual(cut_strip(10, self_feed_mm=10), ESC_INIT + ESC_CUT)

    def test_longer_strip_feeds_the_rest_forward(self):
        self.assertEqual(cut_strip(15, self_feed_mm=10), ESC_INIT + ESC_FEED + bytes([40]) + ESC_CUT)

    def test_shorter_strip_backs_the_paper_up_first(self):
        # 1 mm strip: back up 9 mm (72 dots) so ESC i's own 10 mm leaves 1 mm.
        self.assertEqual(cut_strip(1, self_feed_mm=10), ESC_INIT + b"\x1bj" + bytes([72]) + ESC_CUT)

    def test_non_positive_length_is_rejected(self):
        for length in (0, -1):
            with self.subTest(length=length), self.assertRaises(ValueError):
                cut_strip(length)


if __name__ == "__main__":
    unittest.main()
