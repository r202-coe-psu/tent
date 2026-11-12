"""Shared request helpers for public FastAPI routers."""

from __future__ import annotations

import re

from fastapi import Request

#: Same shape nginx / most tracing tools emit; anything else is client noise we do not store.
_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")


def client_ip(request: Request) -> str:
    """Best-effort client IP for audit records (e.g. search ``ip_hash``).

    Prefer ``X-Real-IP`` (set by our nginx, or by the SvelteKit BFF for the
    calls it proxies) over the first ``X-Forwarded-For`` hop, which is
    spoofable when FastAPI is reached without a trusted proxy. Rate limiting
    is enforced by nginx, not here (CR-188).
    """
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def audit_request_id(request: Request) -> str | None:
    """`X-Request-ID` for tying an audit row to FastAPI / nginx logs, or `None`.

    The header is client-controlled on public routes and the audit log is permanent, so only a
    short, plain token is kept; a missing or malformed value yields `None` (never an error).
    """
    value = request.headers.get("x-request-id", "").strip()
    return value if _REQUEST_ID.fullmatch(value) else None
