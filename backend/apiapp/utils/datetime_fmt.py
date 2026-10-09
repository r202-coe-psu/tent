"""UTC ISO-8601 helpers for API / Couch JSON payloads."""

from __future__ import annotations

from datetime import UTC, datetime


def utc_z_isoformat(ts: datetime) -> str:
    """Serialize ``ts`` as UTC with a ``Z`` suffix.

    PyMongo/Beanie round-trip BSON dates as naive UTC. A bare
    ``.isoformat()`` then omits the offset, and browsers treat that form as
    *local* time — shifting Thailand displays by −7h. Always emit ``Z``.
    """
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC).isoformat().replace("+00:00", "Z")
