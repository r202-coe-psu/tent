"""Tests for search query parsing."""

from apiapp.utils.search_query import SearchQueryKind, parse_search_query


def test_parse_national_id():
    parsed = parse_search_query("3 9001 0024 419 2")
    assert parsed is not None
    assert parsed.kind == SearchQueryKind.NATIONAL_ID
    assert parsed.normalized == "3900100244192"


def test_parse_phone():
    parsed = parse_search_query("0812345678")
    assert parsed is not None
    assert parsed.kind == SearchQueryKind.PHONE
    assert parsed.normalized == "0812345678"


def test_parse_passport():
    parsed = parse_search_query("AB1234567")
    assert parsed is not None
    assert parsed.kind == SearchQueryKind.PASSPORT
    assert parsed.normalized == "AB1234567"


def test_parse_name():
    parsed = parse_search_query("สมชาย ใจดี")
    assert parsed is not None
    assert parsed.kind == SearchQueryKind.NAME
    assert parsed.normalized == "สมชาย ใจดี"


def test_parse_name_normalizes_to_a_search_key():
    parsed = parse_search_query("  SomChai   Smith ")
    assert parsed is not None
    assert parsed.kind == SearchQueryKind.NAME
    assert parsed.normalized == "somchai smith"


def test_parse_name_accepts_two_grapheme_words():
    parsed = parse_search_query("สม")
    assert parsed is not None
    assert parsed.kind == SearchQueryKind.NAME
    assert parse_search_query("สม มา") is not None


def test_parse_rejects_a_word_under_two_graphemes():
    assert parse_search_query("a") is None
    assert parse_search_query("ก ข") is None
    assert parse_search_query("สมหมาย ก") is None
    # ที่ and มี are two or three code points each but one grapheme (consonant + marks).
    assert parse_search_query("ที่") is None
    assert parse_search_query("สมหมาย มี") is None


def test_parse_rejects_a_nul_byte():
    # MongoDB cannot take a NUL inside the $regex built from the query.
    assert parse_search_query("\x00\x00") is None
    assert parse_search_query("สม\x00หมาย") is None


def test_lone_surrogate_is_rejected() -> None:
    # Valid in a JSON string but not encodable to BSON: the query would 500 (#744 review).
    assert parse_search_query("\ud800x ab") is None


def test_parse_rejects_more_than_four_words():
    assert parse_search_query("สม ชาย มา โชค") is not None
    assert parse_search_query("สม ชาย มา โชค ใจ") is None


def test_parse_name_treats_decomposed_sara_am_like_the_composed_form():
    composed = parse_search_query("นำ้ใจ ใจดี")
    decomposed = parse_search_query("น\u0e4d\u0e32้ใจ ใจดี")
    assert composed is not None and decomposed is not None
    assert composed.normalized == decomposed.normalized
