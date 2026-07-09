"""Privacy transforms for public API responses."""

from __future__ import annotations

import hashlib

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


def phone_hash(phone: str | None) -> str | None:
    if not phone:
        return None
    return sha256_hex(phone)


def national_id_hash(national_id: str) -> str:
    return sha256_hex(national_id)


def passport_hash(passport_id: str) -> str:
    return sha256_hex(passport_id.upper())
