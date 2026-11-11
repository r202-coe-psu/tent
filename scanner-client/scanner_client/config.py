"""Settings from a `.env` next to the .exe; process environment overrides it (issue #1326).

Validation errors name the KEY only, never the value (a URL could carry credentials).
"""

import ipaddress
import math
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

DEFAULT_WALK_IN_PATH = "/onsite/people/new"
BROWSER_CHANNELS = ("msedge", "chrome", "chromium")
# Same default as the kiosk's card poll loop (kiosk/app/manager.py: POLL_INTERVAL, "0.5").
DEFAULT_POLL_INTERVAL = 0.5
POLL_INTERVAL_RANGE = (0.2, 10.0)
_TRUE = {"true", "1", "yes"}
_FALSE = {"false", "0", "no"}
_DEFAULT_PORTS = {"http": 80, "https": 443}


class ConfigError(ValueError):
    """A safe, operator-facing configuration error: names keys, never values."""


@dataclass(frozen=True)
class Settings:
    shelter_origin: str
    walk_in_path: str
    browser_channel: str
    card_reader_name: str | None
    keep_login: bool
    poll_interval: float


def _is_loopback_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _shelter_origin(raw: str) -> str:
    if not raw:
        raise ConfigError("SHELTER_URL is required")
    bad = ConfigError("SHELTER_URL must be an origin only: http(s)://host[:port]")
    if "?" in raw or "#" in raw:
        raise bad
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise bad from None
    host = (parts.hostname or "").lower()
    if parts.scheme not in _DEFAULT_PORTS or not host:
        raise bad
    if "@" in parts.netloc or parts.path not in ("", "/"):
        raise bad
    if parts.scheme == "http" and not _is_loopback_host(host):
        raise ConfigError("SHELTER_URL must use https unless the host is loopback")
    shown_host = f"[{host}]" if ":" in host else host
    if port is None or port == _DEFAULT_PORTS[parts.scheme]:
        return f"{parts.scheme}://{shown_host}"
    return f"{parts.scheme}://{shown_host}:{port}"


def _walk_in_path(raw: str) -> str:
    value = raw or DEFAULT_WALK_IN_PATH
    if not value.startswith("/"):
        raise ConfigError("WALK_IN_PATH must start with '/'")
    return value


def _browser_channel(raw: str, platform: str) -> str:
    value = raw.lower() or ("msedge" if platform.startswith("win") else "chromium")
    if value not in BROWSER_CHANNELS:
        raise ConfigError(f"BROWSER_CHANNEL must be one of: {', '.join(BROWSER_CHANNELS)}")
    return value


def _keep_login(raw: str) -> bool:
    value = raw.lower()
    if not value:
        return False
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ConfigError("KEEP_LOGIN must be true/false/1/0/yes/no")


def _poll_interval(raw: str) -> float:
    lo, hi = POLL_INTERVAL_RANGE
    try:
        value = float(raw) if raw else DEFAULT_POLL_INTERVAL
    except ValueError:
        raise ConfigError("POLL_INTERVAL must be a number of seconds") from None
    if math.isnan(value) or not lo <= value <= hi:
        raise ConfigError(f"POLL_INTERVAL must be between {lo} and {hi} seconds")
    return value


def load_settings(
    env_path: Path, environ: Mapping[str, str], platform: str = sys.platform
) -> Settings:
    """Read `env_path` as defaults, let `environ` override, validate, return Settings."""
    file_values = {k: v for k, v in dotenv_values(env_path).items() if v is not None}
    config = {**file_values, **environ}

    def get(key: str) -> str:
        return str(config.get(key) or "").strip()

    return Settings(
        shelter_origin=_shelter_origin(get("SHELTER_URL")),
        walk_in_path=_walk_in_path(get("WALK_IN_PATH")),
        browser_channel=_browser_channel(get("BROWSER_CHANNEL"), platform),
        card_reader_name=get("CARD_READER_NAME") or None,
        keep_login=_keep_login(get("KEEP_LOGIN")),
        poll_interval=_poll_interval(get("POLL_INTERVAL")),
    )
