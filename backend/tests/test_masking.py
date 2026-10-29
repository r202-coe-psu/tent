"""Tests for masking helpers."""

from apiapp.utils.masking import (
    last_name_hash,
    mask_last_name,
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
    # frontend/src/lib/db/model.ts normalizeThaiPhone — hashes must agree (CR-206 FR-1)
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
