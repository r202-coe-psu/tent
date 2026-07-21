"""Privacy transforms for public read-model projection."""

from __future__ import annotations

import hashlib
import re

import grapheme


def sha256_hex(value: str) -> str:
    """UTF-8 SHA-256 hex digest — matches frontend ``$lib/db/hash.ts``."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mask_last_name(last_name: str) -> str:
    """
    Mask surname for public index.

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
    """Mask Thai national ID — e.g. ``390-XXXX-XX-192``."""
    digits = normalize_national_id(national_id)
    if len(digits) < 6:
        return "****"
    if len(digits) >= 13:
        return f"{digits[:3]}-XXXX-XX-{digits[10:13]}"
    return f"{digits[:3]}***{digits[-3:]}"


def mask_passport(passport_id: str) -> str:
    """Mask passport — e.g. ``A...ZNNNNNN``."""
    value = passport_id.upper()
    if len(value) <= 4:
        return f"{value[0]}****" if value else "****"
    return f"{value[0]}...{value[-2:]}{'*' * max(0, len(value) - 4)}"


def phone_hash(phone: str | None) -> str | None:
    if not phone:
        return None
    return sha256_hex(phone)


def mask_address(household: dict | None) -> str | None:
    """Mask household address for public tier — hide house number."""
    if not household:
        return None
    parts: list[str] = []
    if household.get("subdistrict"):
        parts.append(f"ต.{household['subdistrict']}")
    if household.get("district"):
        parts.append(f"อ.{household['district']}")
    if household.get("province"):
        parts.append(f"จ.{household['province']}")
    if not parts:
        return None
    return f"**/* {' '.join(parts)}"


def shelter_code_from_db_name(db_name: str) -> str | None:
    """``shelter_sh001`` → ``SH001``."""
    if not db_name.startswith("shelter_"):
        return None
    return db_name.removeprefix("shelter_").upper()


def shelter_db_name(shelter_code: str) -> str:
    return f"shelter_{shelter_code.lower()}"
