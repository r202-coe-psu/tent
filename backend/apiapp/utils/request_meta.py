"""Shared request helpers for public FastAPI routers."""

from __future__ import annotations

from fastapi import Request


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
