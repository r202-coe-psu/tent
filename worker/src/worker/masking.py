"""Privacy transforms for public read-model projection."""

from __future__ import annotations

import hashlib

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


def phone_hash(phone: str | None) -> str | None:
    if not phone:
        return None
    return sha256_hex(phone)


def shelter_code_from_db_name(db_name: str) -> str | None:
    """``shelter_sh001`` → ``SH001``."""
    if not db_name.startswith("shelter_"):
        return None
    return db_name.removeprefix("shelter_").upper()


def shelter_db_name(shelter_code: str) -> str:
    return f"shelter_{shelter_code.lower()}"
