"""Minimal Crockford-base32 ULID (26 chars) — matches frontend `$lib/db/ulid.ts`."""

from __future__ import annotations

import os
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_ulid(seed_time_ms: int | None = None) -> str:
    """Generate a 26-char ULID (48-bit time + 80-bit randomness)."""
    ms = int(time.time() * 1000) if seed_time_ms is None else seed_time_ms
    time_chars = ["0"] * 10
    for i in range(9, -1, -1):
        time_chars[i] = _CROCKFORD[ms & 0x1F]
        ms >>= 5

    rand = int.from_bytes(os.urandom(10), "big")
    rand_chars = ["0"] * 16
    for i in range(15, -1, -1):
        rand_chars[i] = _CROCKFORD[rand & 0x1F]
        rand >>= 5

    return "".join(time_chars) + "".join(rand_chars)
