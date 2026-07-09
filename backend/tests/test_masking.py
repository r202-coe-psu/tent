"""Tests for masking helpers."""

from apiapp.utils.masking import mask_last_name, national_id_hash, phone_hash


def test_mask_last_name_long_thai():
    assert mask_last_name("ประเสริฐ") == "ปร****ริฐ"


def test_mask_last_name_short():
    assert mask_last_name("ดี") == "ดี****"


def test_phone_hash_is_deterministic():
    assert phone_hash("0812345678") == phone_hash("0812345678")
    assert phone_hash("0812345678") != phone_hash("0812345679")


def test_national_id_hash_is_deterministic():
    assert national_id_hash("3900100244192") == national_id_hash("3900100244192")
