import asyncio
from datetime import UTC, datetime

from scanner_client.card_session import CardSession

CONTRACT_CARD_KEYS = {
    "citizen_id",
    "first_name_th",
    "last_name_th",
    "gender",
    "birth_date",
    "birth_year_ce",
    "age",
    "address_no",
    "village_no",
    "lane",
    "road",
    "subdistrict",
    "district",
    "province",
    "scanned_at",
}

JPEG_BYTES = b"\xff\xd8\xff\xe0"  # base64 -> "/9j/4A=="


class FakePage:
    """Records each dispatched (event_name, detail); True = the web page called preventDefault()."""

    def __init__(self):
        self.events: list[tuple[str, dict]] = []

    async def evaluate(self, script, arg):
        name, detail = arg
        self.events.append((name, detail))
        return True


class FakeReader:
    """Same surface as kiosk ThaiSmartCardReader, no hardware. Card: b. 12 Apr 2535 BE."""

    def connect(self):
        return True

    def get_citizen_id(self):
        return "1234567890123"

    def get_thai_name_parts(self):
        return ["นาย", "สมชาย", "", "ใจดี"]

    def get_date_of_birth(self):
        return "25350412"

    def get_gender(self):
        return "male"

    def get_address_parts(self):
        return ["99/1", "หมู่ที่ 3", "", "ซอย 5", "", "ตำบลในเมือง", "อำเภอเมือง", "จังหวัดขอนแก่น"]

    def read_photo(self):
        return JPEG_BYTES


def test_inserted_card_dispatches_reading_then_text_card_then_photo():
    page = FakePage()
    session = CardSession(now=lambda: datetime(2026, 11, 11, 9, 0, tzinfo=UTC))

    asyncio.run(session.handle_card(FakeReader(), page))

    assert [name for name, _ in page.events] == [
        "scanner:card-reading",
        "scanner:card-read",
        "scanner:card-photo",
    ]
    reading, card, photo = (detail for _, detail in page.events)
    assert reading == {}
    assert set(card) == CONTRACT_CARD_KEYS
    assert card["citizen_id"] == "1234567890123"
    assert card["first_name_th"] == "สมชาย"
    assert card["last_name_th"] == "ใจดี"
    assert card["gender"] == "male"
    assert card["birth_date"] == "25350412"
    assert card["birth_year_ce"] == 1992
    assert card["age"] == 34
    assert card["address_no"] == "99/1"
    assert card["village_no"] == "3"
    assert card["lane"] == "ซอย 5"
    assert card["road"] == ""
    assert card["subdistrict"] == "ในเมือง"
    assert card["district"] == "เมือง"
    assert card["province"] == "ขอนแก่น"
    assert card["scanned_at"] == "2026-11-11T09:00:00+00:00"
    assert photo == {
        "citizen_id": "1234567890123",
        "photo_base64": "data:image/jpeg;base64,/9j/4A==",
    }
