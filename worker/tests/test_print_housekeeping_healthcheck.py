"""jobs-worker healthcheck — file read faked, no real fs."""

from __future__ import annotations

from worker.jobs.healthcheck import is_healthy

NOW_MS = 1_700_000_200_000
ENV = {"JOBS_OK_DIR": "/run/ok", "PRINT_HOUSEKEEPING_TOKEN": "t"}


def reads(files: dict[str, str]):
    def read_file(path: str) -> str:
        if path not in files:
            raise FileNotFoundError(path)
        return files[path]

    return read_file


def stamp(age_s: int) -> str:
    return str(NOW_MS - age_s * 1000)


def test_healthy_when_only_edge_copy_enabled_and_fresh() -> None:
    env = {"JOBS_OK_DIR": "/run/ok"}
    assert is_healthy(
        env, now_ms=NOW_MS, read_file=reads({"/run/ok/edge-users-copy.ok": stamp(60)})
    )


def test_disabled_jobs_are_skipped() -> None:
    # printing has no token -> only edge-users-copy is checked.
    env = {"JOBS_OK_DIR": "/run/ok"}
    assert is_healthy(
        env, now_ms=NOW_MS, read_file=reads({"/run/ok/edge-users-copy.ok": stamp(1)})
    )


def test_unhealthy_when_enabled_job_file_missing() -> None:
    files = {"/run/ok/edge-users-copy.ok": stamp(1)}
    assert not is_healthy(
        ENV, is_dir=lambda _p: True, now_ms=NOW_MS, read_file=reads(files)
    )


def all_files(printing_age: int) -> dict[str, str]:
    return {
        "/run/ok/printing.ok": stamp(printing_age),
        "/run/ok/edge-users-copy.ok": stamp(1),
    }


def test_healthy_at_exactly_120_seconds() -> None:
    assert is_healthy(
        ENV, is_dir=lambda _p: True, now_ms=NOW_MS, read_file=reads(all_files(120))
    )


def test_unhealthy_at_121_seconds() -> None:
    assert not is_healthy(
        ENV, is_dir=lambda _p: True, now_ms=NOW_MS, read_file=reads(all_files(121))
    )


def test_slow_tick_allows_four_missed_ticks() -> None:
    env = {**ENV, "JOBS_TICK_SECONDS": "60"}
    assert is_healthy(
        env, is_dir=lambda _p: True, now_ms=NOW_MS, read_file=reads(all_files(200))
    )
    assert not is_healthy(
        env, is_dir=lambda _p: True, now_ms=NOW_MS, read_file=reads(all_files(241))
    )


def test_unhealthy_when_file_is_garbage_or_empty() -> None:
    for bad in ("", "not-a-time"):
        files = {**all_files(1), "/run/ok/printing.ok": bad}
        assert not is_healthy(
            ENV, is_dir=lambda _p: True, now_ms=NOW_MS, read_file=reads(files)
        )


def test_unhealthy_when_file_unreadable() -> None:
    def read_file(path: str) -> str:
        raise PermissionError(path)

    assert not is_healthy(
        ENV, is_dir=lambda _p: True, now_ms=NOW_MS, read_file=read_file
    )


def test_healthy_when_ok_dir_absent_not_a_jobs_worker():
    # sync-worker shares the image HEALTHCHECK but never creates the OK dir.
    assert is_healthy(
        ENV, now_ms=NOW_MS, read_file=lambda p: "", is_dir=lambda _p: False
    )
