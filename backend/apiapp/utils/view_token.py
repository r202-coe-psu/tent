"""Read-only ticket references handed out by phone lookup.

The Access Portal signs a volunteer in with the phone number they applied with. A phone
number is guessable in a way a 128-bit ticket token is not, so handing the real token
back to anyone who types the right number would let a stranger **cancel** someone's
shift — damage that cannot be undone from the volunteer's side.

So phone lookup returns one of these instead: a reference that opens the pass read-only
and expires. Cancelling still requires the tracking token itself, which reaches only the
person who applied (the URL they were redirected to, the link they saved, their QR).

Stateless on purpose — HMAC over the application id and an expiry, keyed by the server
secret. No storage to keep in step with retention, and nothing extra to leak.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

from ..core.config import get_settings

#: How long a reference minted by a phone lookup stays usable. Long enough to read the
#: pass and show it at a gate, short enough that a lookup someone else performed does
#: not stay live in a browser history for a day.
VIEW_TOKEN_TTL_SECONDS = 30 * 60

_PREFIX = "VIEW-"


def _sign(payload: str) -> str:
    secret = (get_settings().SECRET_KEY or "").encode("utf-8")
    digest = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _b64(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def _unb64(value: str) -> str:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding).decode("utf-8")


def mint_view_token(application_id: str, *, now: float | None = None) -> str:
    """A read-only reference to one application, valid for ``VIEW_TOKEN_TTL_SECONDS``."""
    expires_at = int((now if now is not None else time.time()) + VIEW_TOKEN_TTL_SECONDS)
    payload = f"{application_id}|{expires_at}"
    return f"{_PREFIX}{_b64(payload)}.{_sign(payload)}"


def is_view_token(token: str) -> bool:
    """Whether this looks like a view reference rather than a tracking token.

    Only a shape check — `resolve_view_token` is what decides if it is genuine.
    """
    return token.startswith(_PREFIX)


def resolve_view_token(token: str, *, now: float | None = None) -> str | None:
    """The application id this reference points at, or ``None`` if it is not usable.

    Returns ``None`` for a forged signature, a malformed token and an expired one alike:
    the caller answers all three with the same 404, so a probe cannot tell them apart.
    """
    if not is_view_token(token):
        return None
    body = token[len(_PREFIX) :]
    encoded, _, signature = body.partition(".")
    if not encoded or not signature:
        return None
    try:
        payload = _unb64(encoded)
    except (ValueError, UnicodeDecodeError):
        return None
    # Constant-time: a byte-by-byte comparison here would leak the expected signature.
    if not hmac.compare_digest(signature, _sign(payload)):
        return None

    application_id, _, expires_raw = payload.rpartition("|")
    if not application_id:
        return None
    try:
        expires_at = int(expires_raw)
    except ValueError:
        return None
    if (now if now is not None else time.time()) > expires_at:
        return None
    return application_id
