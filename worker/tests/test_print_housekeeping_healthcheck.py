"""Print housekeeping healthcheck (CR-222 FR-17) — file read faked, no real fs."""

from __future__ import annotations

from worker.printing.healthcheck import is_healthy


def never_read(path: str) -> str:
    raise AssertionError(f"read_file should not be called, got {path}")


def test_healthy_when_housekeeping_has_no_token() -> None:
    assert is_healthy({}, now_ms=1_700_000_000_000, read_file=never_read) is True


TOKEN_ENV = {
    "PRINT_HOUSEKEEPING_TOKEN": "s3cret-token-value",
    "PRINT_HOUSEKEEPING_OK_FILE": "/run/hk.ok",
}
NOW_MS = 1_700_000_200_000


def reads(content: str):
    def read_file(path: str) -> str:
        assert path == "/run/hk.ok"
        return content

    return read_file


def test_healthy_when_ok_file_is_60_seconds_old() -> None:
    assert (
        is_healthy(TOKEN_ENV, now_ms=NOW_MS, read_file=reads("1700000140000")) is True
    )


def test_unhealthy_when_ok_file_is_121_seconds_old() -> None:
    assert (
        is_healthy(TOKEN_ENV, now_ms=NOW_MS, read_file=reads("1700000079000")) is False
    )


def test_healthy_when_ok_file_is_exactly_120_seconds_old() -> None:
    assert (
        is_healthy(TOKEN_ENV, now_ms=NOW_MS, read_file=reads("1700000080000")) is True
    )


def test_unhealthy_when_ok_file_is_missing() -> None:
    def read_file(path: str) -> str:
        raise FileNotFoundError(path)

    assert is_healthy(TOKEN_ENV, now_ms=NOW_MS, read_file=read_file) is False


def test_unhealthy_when_ok_file_is_unreadable() -> None:
    def read_file(path: str) -> str:
        raise PermissionError(path)

    assert is_healthy(TOKEN_ENV, now_ms=NOW_MS, read_file=read_file) is False


def test_unhealthy_when_ok_file_is_empty() -> None:
    assert is_healthy(TOKEN_ENV, now_ms=NOW_MS, read_file=reads("")) is False


def test_unhealthy_when_ok_file_is_not_a_number() -> None:
    assert is_healthy(TOKEN_ENV, now_ms=NOW_MS, read_file=reads("not-a-time")) is False


SLOW_ENV = {**TOKEN_ENV, "PRINT_HOUSEKEEPING_INTERVAL_MS": "60000"}


def test_slow_interval_allows_four_missed_ticks() -> None:
    # 60 s interval -> limit 240 s; the ok file is 200 s old.
    assert is_healthy(SLOW_ENV, now_ms=NOW_MS, read_file=reads("1700000000000")) is True


def test_slow_interval_is_unhealthy_past_four_ticks() -> None:
    # 60 s interval -> limit 240 s; the ok file is 241 s old.
    assert (
        is_healthy(SLOW_ENV, now_ms=NOW_MS, read_file=reads("1699999959000")) is False
    )
