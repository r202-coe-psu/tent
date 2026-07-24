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


def test_parse_rejects_short_name():
    assert parse_search_query("ab") is None
