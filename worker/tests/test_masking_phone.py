"""`normalize_phone` must match the frontend `normalizeThaiPhone` so `phone_hash` agrees (CR-206)."""

from worker.masking import normalize_phone, phone_hash


def test_normalize_phone_matches_frontend_normalizer():
    assert normalize_phone("081.234.5678") == "0812345678"
    assert normalize_phone("(081) 234-5678") == "0812345678"
    assert normalize_phone("66812345678") == "0812345678"
    assert normalize_phone("+66812345678") == "0812345678"


def test_formats_of_the_same_mobile_hash_alike():
    assert (
        phone_hash("081-234-5678")
        == phone_hash("+66812345678")
        == phone_hash("0812345678")
    )
