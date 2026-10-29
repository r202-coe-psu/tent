"""Detect evacuee search query type from user input."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

import grapheme

from .masking import name_key, normalize_phone


class SearchQueryKind(StrEnum):
    NATIONAL_ID = "national_id"
    PASSPORT = "passport"
    PHONE = "phone"
    NAME = "name"


@dataclass(frozen=True)
class ParsedSearchQuery:
    kind: SearchQueryKind
    raw: str
    normalized: str


#: Every word of a name query must have at least this many graphemes (CR-166).
MIN_NAME_WORD_GRAPHEMES = 2
#: More words than this is rejected — bounds the `$or` branches built per query.
MAX_NAME_WORDS = 4

_DIGITS_ONLY = re.compile(r"^\d+$")
_PASSPORT = re.compile(r"^[A-Za-z]{1,2}\d{6,9}$")
_THAI_PHONE = re.compile(r"^0\d{9}$")  # 10-digit mobile only (CR-206)


def _normalize_phone(value: str) -> str | None:
    digits = normalize_phone(value)
    if _THAI_PHONE.fullmatch(digits):
        return digits
    return None


def parse_search_query(raw_query: str) -> ParsedSearchQuery | None:
    """Classify an evacuee search query string."""
    raw = raw_query.strip()
    if not raw:
        return None
    # MongoDB rejects a NUL inside a $regex (the first-name prefix match) with a 500.
    if "\x00" in raw:
        return None
    # A lone surrogate (valid in a JSON string) cannot be encoded to BSON — the query would 500.
    try:
        raw.encode("utf-8")
    except UnicodeEncodeError:
        return None

    compact = re.sub(r"[\s\-]+", "", raw)

    if _DIGITS_ONLY.fullmatch(compact):
        if len(compact) == 13:
            return ParsedSearchQuery(
                kind=SearchQueryKind.NATIONAL_ID,
                raw=raw,
                normalized=compact,
            )
        phone = _normalize_phone(compact if compact.startswith("0") else f"0{compact}")
        if phone:
            return ParsedSearchQuery(
                kind=SearchQueryKind.PHONE,
                raw=raw,
                normalized=phone,
            )
        return None

    if _PASSPORT.fullmatch(compact):
        return ParsedSearchQuery(
            kind=SearchQueryKind.PASSPORT,
            raw=raw,
            normalized=compact.upper(),
        )

    phone = _normalize_phone(compact)
    if phone:
        return ParsedSearchQuery(
            kind=SearchQueryKind.PHONE,
            raw=raw,
            normalized=phone,
        )

    # Name query: `normalized` is the search key (NFKC/casefold/single spaces), one word
    # per space. Judging each word (not the whole string) is what keeps "ก ข" out.
    key = name_key(raw)
    words = key.split(" ")
    if len(words) > MAX_NAME_WORDS:
        return None
    if any(grapheme.length(word) < MIN_NAME_WORD_GRAPHEMES for word in words):
        return None

    return ParsedSearchQuery(
        kind=SearchQueryKind.NAME,
        raw=raw,
        normalized=key,
    )
