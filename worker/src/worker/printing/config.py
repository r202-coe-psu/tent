"""Print housekeeping settings read from the environment (CR-222 FR-17).

Kept free of ``httpx`` so the container healthcheck stays a light process.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

DEFAULT_INTERVAL_MS = 30_000
DEFAULT_OK_FILE = "/tmp/print-housekeeping.ok"
DEFAULT_URL = "http://frontend:3000"

_ENDPOINT_PATH = "/api/internal/printers/housekeeping"
_MIN_INTERVAL_MS = 1000


@dataclass(frozen=True)
class HousekeepingConfig:
    endpoint: str
    token: str = field(repr=False)
    interval_ms: int
    ok_file: str


def _parse_interval_ms(raw: str | None) -> int:
    try:
        value = int(raw) if raw else DEFAULT_INTERVAL_MS
    except ValueError:
        return DEFAULT_INTERVAL_MS
    return value if value >= _MIN_INTERVAL_MS else DEFAULT_INTERVAL_MS


def load_housekeeping_config(env: Mapping[str, str]) -> HousekeepingConfig | None:
    """Read the task config from ``env``; ``None`` when no token is set (task disabled)."""
    token = env.get("PRINT_HOUSEKEEPING_TOKEN", "")
    if not token:
        return None
    base_url = (env.get("PRINT_HOUSEKEEPING_URL") or DEFAULT_URL).removesuffix("/")
    return HousekeepingConfig(
        endpoint=f"{base_url}{_ENDPOINT_PATH}",
        token=token,
        interval_ms=_parse_interval_ms(env.get("PRINT_HOUSEKEEPING_INTERVAL_MS")),
        ok_file=env.get("PRINT_HOUSEKEEPING_OK_FILE") or DEFAULT_OK_FILE,
    )
