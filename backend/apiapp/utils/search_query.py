"""Detect evacuee search query type from user input."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class SearchQueryKind(str, Enum):
    NATIONAL_ID = "national_id"
    PASSPORT = "passport"
    PHONE = "phone"
    NAME = "name"


@dataclass(frozen=True)
class ParsedSearchQuery:
    kind: SearchQueryKind
    raw: str
    normalized: str


_DIGITS_ONLY = re.compile(r"^\d+$")
_PASSPORT = re.compile(r"^[A-Za-z]{1,2}\d{6,9}$")
_THAI_PHONE = re.compile(r"^0\d{8,9}$")


def _normalize_phone(value: str) -> str | None:
    digits = re.sub(r"[\s\-()]+", "", value)
    if digits.startswith("+66"):
        digits = f"0{digits[3:]}"
    if _THAI_PHONE.fullmatch(digits):
        return digits
    return None


def parse_search_query(raw_query: str) -> ParsedSearchQuery | None:
    """Classify an evacuee search query string."""
    raw = raw_query.strip()
    if not raw:
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

    if len(raw) < 3:
        return None

    return ParsedSearchQuery(
        kind=SearchQueryKind.NAME,
        raw=raw,
        normalized=raw,
    )
