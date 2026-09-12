"""Short codes a shelter manager reads out when offering a shift.

A volunteer has no account, so answering a dispatched shift needs something they hold.
A 128-bit token is right for a link, but this one is spoken — the manager calls and
reads it out — so it has to survive being said aloud and typed back.

Six characters in two groups of three, from an alphabet with every look-alike and
sound-alike removed: no ``I``, ``L``, ``O``, ``U``, and no ``0`` or ``1`` (which get
read back as O and I). That is ~729 million codes, which is not much on its own. The
security is in needing all three: the volunteer's phone number, which the portal signs
in with and the server checks against the assignment; the code, usable once; and a
rate limit on the endpoint. No single one of them is enough.

Deliberately no look-alike substitution on input. Crockford's scheme folds I/L onto 1
and O onto 0, but this alphabet has no 1 or 0 to fold onto, and mapping them onto some
other valid character would silently turn a typo into a different real code.
"""

from __future__ import annotations

import re
import secrets

_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
_GROUP_SIZE = 3
_GROUPS = 2
_LENGTH = _GROUP_SIZE * _GROUPS

#: Whatever a person types back: with or without the dash, any case, and with the spaces
#: someone reading from a phone call tends to add.
_SEPARATORS = re.compile(r"[\s-]+")


def new_response_code() -> str:
    """A fresh code in display form, e.g. ``4K7-2M9``."""
    chars = [secrets.choice(_ALPHABET) for _ in range(_LENGTH)]
    return "-".join(
        "".join(chars[i : i + _GROUP_SIZE]) for i in range(0, _LENGTH, _GROUP_SIZE)
    )


def normalize_response_code(value: str) -> str:
    """Canonical form for hashing and comparison — uppercase, separators removed."""
    return _SEPARATORS.sub("", value or "").upper()
