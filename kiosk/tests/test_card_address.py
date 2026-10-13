import unittest

from app.scard import split_card_address

FULL = "99/1#หมู่ที่ 3#ตรอกวัด#ซอยสุขใจ#ถนนเพชรเกษม#ตำบลคลองแห#อำเภอหาดใหญ่#จังหวัดสงขลา".split("#")


class SplitCardAddressTest(unittest.TestCase):
    def test_full_address(self):
        self.assertEqual(
            split_card_address(FULL),
            {
                "address_no": "99/1",
                "village_no": "3",
                "lane": "ตรอกวัด ซอยสุขใจ",
                "road": "ถนนเพชรเกษม",
                "subdistrict": "คลองแห",
                "district": "หาดใหญ่",
                "province": "สงขลา",
            },
        )

    def test_soi_only(self):
        parts = ["99", "", "", "ซอยสุขใจ", "ถนนเพชรเกษม", "ตำบลคลองแห", "อำเภอหาดใหญ่", "จังหวัดสงขลา"]
        result = split_card_address(parts)
        self.assertEqual(result["lane"], "ซอยสุขใจ")
        self.assertEqual(result["road"], "ถนนเพชรเกษม")
        self.assertIsNone(result["village_no"])

    def test_trok_only(self):
        parts = ["99", "", "ตรอกวัด", "", "", "", "", ""]
        self.assertEqual(split_card_address(parts)["lane"], "ตรอกวัด")

    def test_dash_and_empty_parts_are_none(self):
        parts = ["99", "-", "-", " - ", "-", "ตำบลคลองแห", "อำเภอหาดใหญ่", "จังหวัดสงขลา"]
        result = split_card_address(parts)
        self.assertIsNone(result["village_no"])
        self.assertIsNone(result["lane"])
        self.assertIsNone(result["road"])
        self.assertEqual(result["subdistrict"], "คลองแห")

    def test_short_and_empty_part_lists_do_not_raise(self):
        self.assertEqual(
            split_card_address([]),
            {
                "address_no": None,
                "village_no": None,
                "lane": None,
                "road": None,
                "subdistrict": None,
                "district": None,
                "province": None,
            },
        )
        short = split_card_address(["99", "หมู่ที่ 3", "ตรอกวัด"])
        self.assertEqual(short["address_no"], "99")
        self.assertEqual(short["lane"], "ตรอกวัด")
        self.assertIsNone(short["road"])
        self.assertIsNone(short["province"])

    def test_extra_parts_are_ignored(self):
        self.assertEqual(split_card_address(FULL + ["x", "y"])["province"], "สงขลา")


if __name__ == "__main__":
    unittest.main()
