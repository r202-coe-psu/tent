"""Container healthcheck for the print housekeeping loop (CR-222 FR-17)."""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path

from worker.printing.housekeeping import load_housekeeping_config

MAX_AGE_MS = 120_000


def is_healthy(
    env: Mapping[str, str], *, now_ms: int, read_file: Callable[[str], str]
) -> bool:
    cfg = load_housekeeping_config(env)
    if cfg is None:
        return True
    try:
        last_ok_ms = int(read_file(cfg.ok_file).strip())
    except OSError, ValueError:
        return False
    return now_ms - last_ok_ms <= MAX_AGE_MS


def _read_text(path: str) -> str:
    return Path(path).read_text()


def main() -> None:
    import worker.main  # noqa: F401  # keeps the old check that the app imports

    healthy = is_healthy(
        os.environ,
        now_ms=time.time_ns() // 1_000_000,
        read_file=_read_text,
    )
    sys.exit(0 if healthy else 1)
