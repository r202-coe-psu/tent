"""jobs-worker settings read from the environment (issue #1479).

Kept free of ``httpx`` so the container healthcheck stays a light process.
"""

from __future__ import annotations

from collections.abc import Mapping

DEFAULT_TICK_SECONDS = 30.0
DEFAULT_OK_DIR = "/tmp/jobs-ok"
MIN_MAX_AGE_SECONDS = 120.0
# A slower tick would otherwise make every probe fail.
MISSED_TICKS = 4

# Job name -> env var whose presence enables the job (None = always enabled).
# A job disabled here is skipped by the runner and by the healthcheck.
JOB_ENABLE_ENV: dict[str, str | None] = {
    "printing": "PRINT_HOUSEKEEPING_TOKEN",
    "edge-users-copy": None,
    "import-shelter": "SHELTER_IMPORT_WORKER_TOKEN",
    "shelter-close": "SHELTER_CLOSE_WORKER_TOKEN",
}


def _positive_float(raw: str | None, default: float) -> float:
    try:
        value = float(raw) if raw else default
    except ValueError:
        return default
    return value if value > 0 else default


def tick_seconds(env: Mapping[str, str]) -> float:
    return _positive_float(env.get("JOBS_TICK_SECONDS"), DEFAULT_TICK_SECONDS)


def ok_dir(env: Mapping[str, str]) -> str:
    return env.get("JOBS_OK_DIR") or DEFAULT_OK_DIR


def ok_path(env: Mapping[str, str], name: str) -> str:
    return f"{ok_dir(env).rstrip('/')}/{name}.ok"


def max_age_seconds(env: Mapping[str, str]) -> float:
    return max(MIN_MAX_AGE_SECONDS, MISSED_TICKS * tick_seconds(env))


def is_job_enabled(name: str, env: Mapping[str, str]) -> bool:
    key = JOB_ENABLE_ENV.get(name)
    return True if key is None else bool(env.get(key))


def job_budget_seconds(
    env: Mapping[str, str], budget_env: str | None, default: float | None
) -> float | None:
    """Budget in seconds from ``budget_env`` (falls back to ``default``); ``None`` = no budget."""
    if budget_env is None:
        return default
    raw = env.get(budget_env)
    try:
        value = float(raw) if raw else None
    except ValueError:
        value = None
    return value if value is not None and value > 0 else default
