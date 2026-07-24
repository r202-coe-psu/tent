"""Privacy transforms for public API responses."""

from __future__ import annotations

import hashlib
import re

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


def normalize_phone(phone: str) -> str:
    """Digit-only Thai local form — strips spaces/dashes; ``+66`` → leading ``0``."""
    digits = re.sub(r"[\s\-()]+", "", phone)
    if digits.startswith("+66"):
        digits = f"0{digits[3:]}"
    elif digits.startswith("66") and len(digits) >= 11:
        digits = f"0{digits[2:]}"
    return digits


def phone_hash(phone: str | None) -> str | None:
    if not phone:
        return None
    return sha256_hex(normalize_phone(phone))
