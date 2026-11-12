"""Container healthcheck for the print housekeeping loop (CR-222 FR-17)."""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Callable, Mapping
from pathlib import Path

from worker.printing.config import load_housekeeping_config

MIN_MAX_AGE_MS = 120_000
# A slower interval would otherwise make every probe fail.
MISSED_TICKS = 4


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
    max_age_ms = max(MIN_MAX_AGE_MS, MISSED_TICKS * cfg.interval_ms)
    return now_ms - last_ok_ms <= max_age_ms


def _read_text(path: str) -> str:
    return Path(path).read_text()


def main() -> None:
    healthy = is_healthy(
        os.environ,
        now_ms=time.time_ns() // 1_000_000,
        read_file=_read_text,
    )
    sys.exit(0 if healthy else 1)
