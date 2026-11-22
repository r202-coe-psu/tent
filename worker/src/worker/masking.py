"""Search keys (hashes / normalization) for the read-model projection.

Masking of evacuee PII moved to the API in CR-257; `mask_phone` stays for volunteer/job rows.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata


def sha256_hex(value: str) -> str:
    """UTF-8 SHA-256 hex digest — matches frontend ``$lib/db/hash.ts``."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


_WHITESPACE_RUN = re.compile(r"\s+")


def name_key(value: str) -> str:
    """Search key for a name — NFKC, casefold, one space between words, trimmed (CR-166).

    NFKC makes Thai SARA AM (U+0E33) and its decomposed form (U+0E4D U+0E32) compare
    equal. Must produce byte-identical output in the worker and in the backend.
    """
    folded = unicodedata.normalize("NFKC", value).casefold()
    return _WHITESPACE_RUN.sub(" ", folded).strip()


def surname_key(value: str) -> str:
    """`name_key` with every space removed, so "van der Berg" and "vanderberg" match."""
    return name_key(value).replace(" ", "")


def last_name_hash(last_name: str | None) -> str | None:
    """sha256 of the normalized full surname; None when there is no surname (CR-166)."""
    if not last_name:
        return None
    key = surname_key(last_name)
    return sha256_hex(key) if key else None


def normalize_national_id(value: str) -> str:
    return re.sub(r"[\s\-]+", "", value)


def national_id_hash(national_id: str) -> str:
    return sha256_hex(normalize_national_id(national_id))


def passport_hash(passport_id: str) -> str:
    return sha256_hex(passport_id.upper())


_INTL_PHONE = re.compile(r"^\+?66(\d{8,9})$")


def normalize_phone(phone: str) -> str:
    """Digit-only Thai local form — strips spaces/dashes/dots/parentheses; ``+66``/``66`` → ``0``.

    Must match ``normalizeThaiPhone`` in ``frontend/src/lib/db/model.ts`` so ``phone_hash`` agrees.
    """
    compact = re.sub(r"[\s\-.()]+", "", phone.strip())
    intl = _INTL_PHONE.fullmatch(compact)
    return f"0{intl.group(1)}" if intl else compact


def phone_hash(phone: str | None) -> str | None:
    if not phone:
        return None
    return sha256_hex(normalize_phone(phone))


def shelter_code_from_db_name(db_name: str) -> str | None:
    """``shelter_sh001`` → ``SH001``."""
    if not db_name.startswith("shelter_"):
        return None
    return db_name.removeprefix("shelter_").upper()


def shelter_db_name(shelter_code: str) -> str:
    return f"shelter_{shelter_code.lower()}"


def mask_phone(phone: str | None) -> str:
    """``xxx-xxx-1234`` — the only phone form a public volunteer ticket may show.

    FR-VOL-03.4 (CR-092). Keeps the last four digits so an applicant can recognise
    their own ticket, and nothing more: the number itself is on the shelter's CouchDB
    doc, not in any public response.
    """
    digits = normalize_phone(phone or "")
    if len(digits) < 4:
        return "xxx-xxx-xxxx"
    return f"xxx-xxx-{digits[-4:]}"
