"""Timestamp formatting for docs the worker writes to CouchDB."""

from __future__ import annotations

from datetime import UTC, datetime


def iso_utc(value: datetime) -> str:
    """``value`` as ISO-8601 UTC with a trailing ``Z`` — the shape the rest of the
    system writes (``2026-09-25T21:20:18.908Z``, as JS ``toISOString`` does).

    A naive datetime is taken to BE UTC. That is what PyMongo hands back from Mongo
    unless the client is ``tz_aware``, and ``isoformat()`` on it carries no offset —
    so ``.replace("+00:00", "Z")`` never fired, the doc landed without ``Z``, and every
    browser read it as local time: seven hours off in Thailand.
    """
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.isoformat(timespec="milliseconds").replace("+00:00", "Z")
