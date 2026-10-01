import io
import unittest

from PIL import Image

from app.escpos import ESC_INIT, GS_FEED_CUT, GS_RASTER, label_to_escpos


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
    assert data.startswith(ESC_INIT) and data.endswith(GS_FEED_CUT)
    body = data[len(ESC_INIT) : -len(GS_FEED_CUT)]
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

        (row_bytes, rows, payload), = parse_bands(data)

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

    def test_tall_image_is_split_into_bands_of_at_most_255_rows(self):
        data = label_to_escpos(block_png((100, 600), (0, 0, 100, 600)), 576)

        bands = parse_bands(data)

        self.assertEqual([rows for _, rows, _ in bands], [255, 255, 90])
        self.assertTrue(data.endswith(GS_FEED_CUT))

    def test_transparent_pixels_are_paper_not_ink(self):
        image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        image.paste((0, 0, 0, 255), (8, 8, 24, 24))

        (_, rows, payload), = parse_bands(label_to_escpos(png_of(image), 576))

        self.assertEqual(rows, 16)
        self.assertEqual(row_bits(payload, 72, 0).count("1"), 16)

    def test_unreadable_or_blank_images_raise_value_error(self):
        blank = png_of(Image.new("RGB", (64, 64), "white"))
        for name, png in {"garbage": b"\x89PNG\r\n\x1a\nnope", "blank": blank}.items():
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    label_to_escpos(png, 576)

    def test_width_must_be_a_positive_multiple_of_eight(self):
        png = block_png((64, 64), (0, 0, 32, 32))
        for width in (0, 100, -8):
            with self.subTest(width=width):
                with self.assertRaises(ValueError):
                    label_to_escpos(png, width)


if __name__ == "__main__":
    unittest.main()
