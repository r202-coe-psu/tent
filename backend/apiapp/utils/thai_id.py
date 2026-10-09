"""Thai national ID checksum (mod-11) — port of `frontend/src/lib/utils/thai-id.ts` (CR-148).

Accepts separators (spaces / dashes) — only the 13 ASCII digits are checked.
"""

from __future__ import annotations

import re

_NON_DIGIT = re.compile(r"[^0-9]")


def is_valid_thai_national_id(value: str) -> bool:
    digits = _NON_DIGIT.sub("", value)
    if len(digits) != 13:
        return False
    total = sum(int(digits[i]) * (13 - i) for i in range(12))
    return (11 - total % 11) % 10 == int(digits[12])
