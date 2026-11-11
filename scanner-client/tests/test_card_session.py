import asyncio
import logging
from datetime import UTC, datetime

import pytest

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
    """Same surface as kiosk ThaiSmartCardReader, no hardware. Card: b. 12 Apr 2535 BE.

    Failure switches: connect_ok, getter_raises, dob, photo ("ok" | "none" | "raises").
    """

    def __init__(self, connect_ok=True, getter_raises=False, dob="25350412", photo="ok"):
        self.connect_ok = connect_ok
        self.getter_raises = getter_raises
        self.dob = dob
        self.photo = photo

    def connect(self):
        return self.connect_ok

    def get_citizen_id(self):
        return "1234567890123"

    def get_thai_name_parts(self):
        if self.getter_raises:
            raise OSError("card removed")
        return ["นาย", "สมชาย", "", "ใจดี"]

    def get_date_of_birth(self):
        return self.dob

    def get_gender(self):
        return "male"

    def get_address_parts(self):
        return ["99/1", "หมู่ที่ 3", "", "ซอย 5", "", "ตำบลในเมือง", "อำเภอเมือง", "จังหวัดขอนแก่น"]

    def read_photo(self):
        if self.photo == "raises":
            raise OSError("card removed")
        if self.photo == "none":
            return None
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


NOW = lambda: datetime(2026, 11, 11, 9, 0, tzinfo=UTC)  # noqa: E731
PRIVATE_VALUES = ("1234567890123", "สมชาย", "ใจดี", "99/1", "/9j/4A==")


def assert_logs_have_no_card_data(caplog, code):
    messages = [record.getMessage() for record in caplog.records]
    assert any(code in message for message in messages)
    for message in messages:
        for value in PRIVATE_VALUES:
            assert value not in message


@pytest.mark.parametrize(
    "reader",
    [FakeReader(connect_ok=False), FakeReader(getter_raises=True)],
    ids=["connect-returns-false", "getter-raises"],
)
def test_text_read_failure_dispatches_read_failed_and_nothing_else(reader, caplog):
    page = FakePage()
    caplog.set_level(logging.DEBUG)

    asyncio.run(CardSession(now=NOW).handle_card(reader, page))

    assert page.events == [
        ("scanner:card-reading", {}),
        ("scanner:card-error", {"code": "READ_FAILED"}),
    ]
    assert_logs_have_no_card_data(caplog, "READ_FAILED")


@pytest.mark.parametrize("dob", ["", "-", "2535", "abcd0412"])
def test_unusable_date_of_birth_omits_year_and_age_but_is_not_a_failure(dob):
    page = FakePage()

    asyncio.run(CardSession(now=NOW).handle_card(FakeReader(dob=dob), page))

    assert [name for name, _ in page.events] == [
        "scanner:card-reading",
        "scanner:card-read",
        "scanner:card-photo",
    ]
    card = page.events[1][1]
    assert card["birth_date"] == dob
    assert "birth_year_ce" not in card
    assert "age" not in card
    assert set(card) == CONTRACT_CARD_KEYS - {"birth_year_ce", "age"}


@pytest.mark.parametrize("photo", ["none", "raises"])
def test_photo_failure_after_card_read_dispatches_photo_failed(photo, caplog):
    page = FakePage()
    caplog.set_level(logging.DEBUG)

    asyncio.run(CardSession(now=NOW).handle_card(FakeReader(photo=photo), page))

    assert [name for name, _ in page.events] == [
        "scanner:card-reading",
        "scanner:card-read",
        "scanner:card-error",
    ]
    assert page.events[2][1] == {"code": "PHOTO_FAILED"}
    assert_logs_have_no_card_data(caplog, "PHOTO_FAILED")
