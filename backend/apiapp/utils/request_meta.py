"""Shared request helpers for public FastAPI routers."""

from __future__ import annotations

from fastapi import Request


def client_ip(request: Request) -> str:
    """Best-effort client IP for rate limiting.

    Prefer ``X-Real-IP`` (set by our nginx / Vite edge) over the first
    ``X-Forwarded-For`` hop, which is spoofable when FastAPI is reached
    without a trusted proxy. Limits remain **in-process** (not shared across
    replicas) — edge / Redis limiting is an ops follow-up for multi-instance.
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
