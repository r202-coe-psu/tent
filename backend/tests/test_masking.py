"""Tests for masking helpers."""

import pytest

from apiapp.utils.masking import (
    format_full_address,
    full_name,
    last_name_hash,
    mask_address,
    mask_last_name,
    mask_national_id,
    mask_occupant_name,
    mask_passport,
    name_key,
    national_id_hash,
    normalize_phone,
    phone_hash,
    sha256_hex,
    surname_key,
)


def test_mask_last_name_long_thai():
    assert mask_last_name("ประเสริฐ") == "ปร****ริฐ"


def test_mask_last_name_short():
    assert mask_last_name("ดี") == "ดี****"


def test_phone_hash_is_deterministic():
    assert phone_hash("0812345678") == phone_hash("0812345678")
    assert phone_hash("0812345678") != phone_hash("0812345679")


def test_phone_hash_normalizes_formatting():
    assert phone_hash("081-234-5678") == phone_hash("0812345678")
    assert phone_hash("+66812345678") == phone_hash("0812345678")


def test_normalize_phone_plus66():
    assert normalize_phone("+66 81 234 5678") == "0812345678"


def test_normalize_phone_matches_frontend_normalizer():
    # frontend/src/lib/db/model.ts normalizeThaiPhone — hashes must agree (CR-210 FR-1)
    assert normalize_phone("081.234.5678") == "0812345678"
    assert normalize_phone("(081) 234-5678") == "0812345678"
    assert normalize_phone("66812345678") == "0812345678"
    assert normalize_phone("+66812345678") == "0812345678"
    assert normalize_phone("02-222-2222") == "022222222"


def test_national_id_hash_is_deterministic():
    assert national_id_hash("3900100244192") == national_id_hash("3900100244192")


def test_name_key_folds_case_and_collapses_spaces():
    assert name_key("  SomChai \t Smith  ") == "somchai smith"
    assert name_key("") == ""


def test_name_key_composes_thai_sara_am():
    # U+0E33 (SARA AM) NFKC-decomposes to U+0E4D U+0E32; both spellings share one key.
    assert name_key("น\u0e33") == name_key("น\u0e4d\u0e32")


def test_surname_key_drops_every_space():
    assert surname_key("van der Berg") == "vanderberg"
    assert surname_key("  ใจ  ดี ") == "ใจดี"


def test_last_name_hash_is_the_sha256_of_the_surname_key():
    assert last_name_hash("van der Berg") == sha256_hex("vanderberg")
    assert last_name_hash("VANDERBERG") == last_name_hash("van der berg")
    assert last_name_hash("") is None
    assert last_name_hash(None) is None
    assert last_name_hash("   ") is None


# Pinned vectors: the same literals are asserted in worker/tests/projectors/test_projectors.py,
# so the worker (projection) and the backend (query) cannot drift apart on the search keys.
def test_search_key_vectors_are_pinned():
    assert name_key("  SomChai \t Smith  ") == "somchai smith"
    assert name_key("น\u0e33") == "น\u0e4d\u0e32"
    assert surname_key("van der Berg") == "vanderberg"
    assert (
        last_name_hash("van der Berg")
        == "aad607ca3121d5d843c2cd64e8c73c2a24fa3a4cb890ed8d40a1efa8af7a14d5"
    )
    assert (
        last_name_hash("ใจ ดี") == "b3acc4a6f758f651d109f134e9b60fc6e25eabedbe69c3a22d59295a201de85d"
    )
    assert last_name_hash("") is None
    assert last_name_hash(None) is None


# --- CR-257 golden values ---------------------------------------------------------------------
# Captured from the worker's masking (worker/src/worker/masking.py, projectors/occupant.py) at
# PROJECTION_VERSION 22, before masking moved to the API. The public search must keep producing
# exactly these strings.


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("ใจดี", "ใ****"),
        ("ศรีสุวรรณ", "ศรี****รณ"),
        ("Smith", "Sm****th"),
        ("van der Berg", "va****rg"),
        ("", "****"),
        ("ก", "ก****"),
        ("กิ่งแก้ว", "กิ่ง****ก้ว"),
    ],
)
def test_mask_last_name_golden(value, expected):
    assert mask_last_name(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("3901234567192", "390-XXXX-XX-192"),
        ("3-9012-34567-19-2", "390-XXXX-XX-192"),
        ("12345", "****"),
        ("1234567", "123***567"),
        ("AB12345678", "AB1***678"),
    ],
)
def test_mask_national_id_golden(value, expected):
    assert mask_national_id(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [("AA1234567", "A...67*****"), ("ab12", "A****"), ("x", "X****"), ("E123", "E****")],
)
def test_mask_passport_golden(value, expected):
    assert mask_passport(value) == expected


@pytest.mark.parametrize(
    ("parts", "expected"),
    [
        ((None, None, None), None),
        (("คอหงส์", "หาดใหญ่", "สงขลา"), "**/* ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา"),
        ((None, None, "สงขลา"), "**/* จ.สงขลา"),
    ],
)
def test_mask_address_golden(parts, expected):
    assert mask_address(*parts) == expected


@pytest.mark.parametrize(
    ("first", "last", "expected"),
    [
        ("สมชาย", "ใจดี", "สมชาย ใ."),
        ("สมชาย", None, "สมชาย"),
        (None, "ใจดี", "ใจดี"),
        (None, None, "ไม่ระบุชื่อ"),
        ("  สมชาย ", "  ใจดี", "สมชาย ใ."),
        ("John", "Doe", "John D."),
    ],
)
def test_mask_occupant_name_golden(first, last, expected):
    assert mask_occupant_name(first, last) == expected


def test_format_full_address_keeps_house_number_and_skips_empty_parts():
    assert (
        format_full_address(
            address_no="12/3",
            village_no="หมู่ 2",
            subdistrict="คอหงส์",
            district="อำเภอหาดใหญ่",
            province="สงขลา",
            postal_code="90110",
        )
        == "12/3 หมู่ 2 ต.คอหงส์ อำเภอหาดใหญ่ จ.สงขลา 90110"
    )
    assert (
        format_full_address(
            address_no=None,
            village_no="",
            subdistrict=None,
            district=None,
            province=None,
            postal_code=None,
        )
        is None
    )


def test_full_name_skips_an_empty_part():
    assert full_name("สมชาย", "ใจดี") == "สมชาย ใจดี"
    assert full_name("สมชาย", "") == "สมชาย"
    assert full_name(None, None) == ""
