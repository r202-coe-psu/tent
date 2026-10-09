"""Thai national ID checksum — parity with `frontend/src/lib/utils/thai-id.ts`."""

from __future__ import annotations

import pytest

from apiapp.utils.thai_id import is_valid_thai_national_id


def _check_digit(prefix: str) -> str:
    total = sum(int(prefix[i]) * (13 - i) for i in range(12))
    return str((11 - total % 11) % 10)


@pytest.mark.parametrize("prefix", ["190980012345", "110170020345", "312345678901", "000000000000"])
def test_valid_ids(prefix: str) -> None:
    assert is_valid_thai_national_id(prefix + _check_digit(prefix))


def test_known_valid_value() -> None:
    # 1*13+1*12+0*11+1*10+7*9+0*8+0*7+2*6+0*5+3*4+4*3+5*2 = 144 → (11 - 144 % 11) % 10 = 0
    assert is_valid_thai_national_id("1101700203450")


def test_wrong_check_digit() -> None:
    # 1909800123456: weighted sum 333 → check digit 8, not 6
    assert not is_valid_thai_national_id("1909800123456")
    assert is_valid_thai_national_id("1909800123458")


def test_accepts_separators_like_frontend() -> None:
    assert is_valid_thai_national_id("1-1017-00203-45-0")
    assert is_valid_thai_national_id(" 1101700203450 ")


@pytest.mark.parametrize("value", ["", "12345", "11017002034500", "abcdefghijklm", "๑๑๐๑๗๐๐๒๐๓๔๕๙"])
def test_rejects_wrong_length_or_non_ascii_digits(value: str) -> None:
    assert not is_valid_thai_national_id(value)
