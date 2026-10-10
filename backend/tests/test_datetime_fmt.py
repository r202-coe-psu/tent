"""UTC Z serialization — guards the naive-Mongo → browser local-parse skew."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

from apiapp.utils.datetime_fmt import utc_z_isoformat


def test_utc_z_isoformat_aware_utc() -> None:
    ts = datetime(2026, 10, 9, 10, 29, 38, 166000, tzinfo=UTC)
    assert utc_z_isoformat(ts) == "2026-10-09T10:29:38.166000Z"


def test_utc_z_isoformat_naive_assumed_utc() -> None:
    """Mongo round-trip shape: naive wall clock that is already UTC."""
    ts = datetime(2026, 10, 9, 10, 29, 38, 166000)  # tzinfo=None
    assert utc_z_isoformat(ts) == "2026-10-09T10:29:38.166000Z"


def test_utc_z_isoformat_converts_non_utc_offset() -> None:
    bangkok = timezone(timedelta(hours=7))
    ts = datetime(2026, 10, 9, 17, 29, 38, 166000, tzinfo=bangkok)
    assert utc_z_isoformat(ts) == "2026-10-09T10:29:38.166000Z"
