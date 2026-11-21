"""Container healthcheck for ``jobs-worker`` (issue #1479)."""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path

from worker.jobs.config import (
    JOB_ENABLE_ENV,
    is_job_enabled,
    max_age_seconds,
    ok_dir,
    ok_path,
)


def is_healthy(
    env: Mapping[str, str],
    *,
    now_ms: int,
    read_file: Callable[[str], str],
    is_dir: Callable[[str], bool] = os.path.isdir,
) -> bool:
    """Healthy when every enabled job's OK file is fresher than ``max(120 s, 4 × tick)``."""
    # The image's HEALTHCHECK also covers sync-worker, which never runs jobs: the jobs
    # runner creates the OK dir at startup, so no dir means "not a jobs-worker".
    if not is_dir(ok_dir(env)):
        return True
    max_age_ms = max_age_seconds(env) * 1000
    for name in JOB_ENABLE_ENV:
        if not is_job_enabled(name, env):
            continue
        try:
            last_ok_ms = int(read_file(ok_path(env, name)).strip())
        except OSError, ValueError:
            return False
        if now_ms - last_ok_ms > max_age_ms:
            return False
    return True


def _read_text(path: str) -> str:
    return Path(path).read_text()


def main() -> None:
    healthy = is_healthy(
        os.environ,
        now_ms=time.time_ns() // 1_000_000,
        read_file=_read_text,
    )
    sys.exit(0 if healthy else 1)
