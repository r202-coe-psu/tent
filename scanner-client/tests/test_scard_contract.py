"""The client reuses the kiosk's card driver. Every member it calls is named here, so renaming
or removing one in kiosk/app/scard.py breaks this suite instead of the field install."""

import inspect

import pytest
from app.scard import ReaderLostError, ThaiSmartCardReader, split_card_address

READER_MEMBERS_USED = [
    "connect",
    "get_citizen_id",
    "get_thai_name_parts",
    "get_date_of_birth",
    "get_gender",
    "get_address_parts",
    "read_photo",
    "is_card_inserted",
    "close",
]


@pytest.mark.parametrize("member", READER_MEMBERS_USED)
def test_thai_smart_card_reader_still_has_member_the_client_calls(member):
    assert callable(getattr(ThaiSmartCardReader, member, None))


def test_thai_smart_card_reader_still_takes_a_reader_index():
    assert "reader_index" in inspect.signature(ThaiSmartCardReader).parameters


def test_split_card_address_is_still_callable():
    assert callable(split_card_address)


def test_reader_lost_error_is_still_an_exception_the_watcher_can_catch():
    assert issubclass(ReaderLostError, Exception)
