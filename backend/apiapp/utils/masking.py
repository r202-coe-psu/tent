"""Privacy transforms for API responses.

Since CR-257 the Mongo projections hold plaintext PII and every mask is applied here, at
response time. The `mask_*` outputs must stay byte-identical to what the worker stored before
(golden values in `tests/test_masking.py`), so the anonymous public search does not change.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

import grapheme


def sha256_hex(value: str) -> str:
    """UTF-8 SHA-256 hex digest — matches worker and frontend hash helpers."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mask_last_name(last_name: str) -> str:
    """
    Mask surname for public responses.

    >= 5 graphemes: first 2 + **** + last 2
    <= 4 graphemes: first grapheme + ****
    """
    graphemes = list(grapheme.graphemes(last_name))
    if not graphemes:
        return "****"
    if len(graphemes) <= 4:
        return f"{graphemes[0]}****"
    return f"{graphemes[0]}{graphemes[1]}****{graphemes[-2]}{graphemes[-1]}"


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


def mask_national_id(national_id: str) -> str:
    digits = normalize_national_id(national_id)
    if len(digits) < 6:
        return "****"
    if len(digits) >= 13:
        return f"{digits[:3]}-XXXX-XX-{digits[10:13]}"
    return f"{digits[:3]}***{digits[-3:]}"


def mask_passport(passport_id: str) -> str:
    """Mask passport — e.g. ``A...67*****`` (byte-identical to the pre-CR-257 worker output)."""
    value = passport_id.upper()
    if len(value) <= 4:
        return f"{value[0]}****" if value else "****"
    return f"{value[0]}...{value[-2:]}{'*' * max(0, len(value) - 4)}"


def mask_address(subdistrict: str | None, district: str | None, province: str | None) -> str | None:
    """Public-tier residence — house number and village hidden (pre-CR-257 worker output)."""
    parts: list[str] = []
    if subdistrict:
        parts.append(f"ต.{subdistrict}")
    if district:
        parts.append(f"อ.{district}")
    if province:
        parts.append(f"จ.{province}")
    if not parts:
        return None
    return f"**/* {' '.join(parts)}"


def _with_prefix(value: str, short: str, long: str) -> str:
    value = value.strip()
    return value if value.startswith((short, long)) else f"{short}{value}"


def format_full_address(
    *,
    address_no: str | None,
    village_no: str | None,
    subdistrict: str | None,
    district: str | None,
    province: str | None,
    postal_code: str | None,
) -> str | None:
    """Whole residence for partner full mode (CR-257 FR-17) — empty parts are skipped."""
    parts = [
        address_no.strip() if address_no else "",
        village_no.strip() if village_no else "",
        _with_prefix(subdistrict, "ต.", "ตำบล") if subdistrict else "",
        _with_prefix(district, "อ.", "อำเภอ") if district else "",
        _with_prefix(province, "จ.", "จังหวัด") if province else "",
        postal_code.strip() if postal_code else "",
    ]
    joined = " ".join(part for part in parts if part)
    return joined or None


def mask_occupant_name(first_name: str | None, last_name: str | None) -> str:
    """EXT-007 masked name (`สมชาย ใ.`) — byte-identical to the pre-CR-257 worker output."""
    fn = (first_name or "").strip()
    ln = (last_name or "").strip()
    if not fn and not ln:
        return "ไม่ระบุชื่อ"
    if fn and ln:
        return f"{fn} {ln[0]}."
    return fn or ln


def full_name(first_name: str | None, last_name: str | None) -> str:
    """`first last`, either part may be empty."""
    return " ".join(
        part for part in ((first_name or "").strip(), (last_name or "").strip()) if part
    )


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


def mask_email(email: str | None) -> str | None:
    """Mask email for public responses (e.g. s***i@example.com)."""
    if not email or "@" not in email:
        return email
    parts = email.split("@", 1)
    local, domain = parts[0], parts[1]
    if len(local) <= 2:
        masked_local = f"{local[:1]}***"
    else:
        masked_local = f"{local[0]}***{local[-1]}"
    return f"{masked_local}@{domain}"
