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

from dotenv import dotenv_values, set_key

DEFAULT_WALK_IN_PATH = "/onsite/people/new"
# First page the browser opens: the staff login (frontend/src/routes/admin-login).
DEFAULT_START_PATH = "/admin-login"
BROWSER_CHANNELS = ("msedge", "chrome", "chromium")
# Same default as the kiosk's card poll loop (kiosk/app/manager.py: POLL_INTERVAL, "0.5").
DEFAULT_POLL_INTERVAL = 0.5
# Local label printer: the Windows printer name PRINTER.md sets up, and the CUPS queue
# kiosk/setup_printer.sh makes elsewhere.
WINDOWS_PRINTER_NAME = "XP-365B"
CUPS_PRINTER_NAME = "tent_xprinter"
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
    start_path: str
    browser_channel: str
    card_reader_name: str | None
    keep_login: bool
    poll_interval: float
    printer_name: str = WINDOWS_PRINTER_NAME


# Plain http is tolerated on the shelter LAN, where the edge stack serves http only
# (nginx-edge listens on :80). Listed explicitly: ipaddress.is_private also covers 0.0.0.0/8,
# documentation and reserved ranges.
_LAN_NETWORKS = tuple(
    ipaddress.ip_network(n)
    for n in (
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
        "fc00::/7",
        "fe80::/10",
    )
)


def _allows_plain_http(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or any(ip in net for net in _LAN_NETWORKS)


def parse_shelter_origin(raw: str) -> str:
    """Validate SHELTER_URL (env file or the startup prompt) and return the bare origin."""
    raw = raw.strip()
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
    if parts.scheme == "http" and not _allows_plain_http(host):
        raise ConfigError("SHELTER_URL must use https unless the host is loopback or a LAN IP")
    shown_host = f"[{host}]" if ":" in host else host
    if port is None or port == _DEFAULT_PORTS[parts.scheme]:
        return f"{parts.scheme}://{shown_host}"
    return f"{parts.scheme}://{shown_host}:{port}"


def _walk_in_path(raw: str) -> str:
    value = raw or DEFAULT_WALK_IN_PATH
    if not value.startswith("/"):
        raise ConfigError("WALK_IN_PATH must start with '/'")
    return value


def _start_path(raw: str) -> str:
    value = raw or DEFAULT_START_PATH
    if not value.startswith("/") or value.startswith("//"):
        raise ConfigError(
            "START_PATH must be a path on the shelter site starting with a single '/'"
        )
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
    env_path: Path,
    environ: Mapping[str, str],
    platform: str = sys.platform,
    *,
    require_shelter_url: bool = True,
) -> Settings:
    """Read `env_path` as defaults, let `environ` override, validate, return Settings.

    With `require_shelter_url=False` a missing or bad SHELTER_URL becomes "" (the startup
    prompt asks for it); every other key is still validated.
    """
    file_values = {k: v for k, v in dotenv_values(env_path).items() if v is not None}
    config = {**file_values, **environ}

    def get(key: str) -> str:
        return str(config.get(key) or "").strip()

    try:
        shelter_origin = parse_shelter_origin(get("SHELTER_URL"))
    except ConfigError:
        if require_shelter_url:
            raise
        shelter_origin = ""

    return Settings(
        shelter_origin=shelter_origin,
        walk_in_path=_walk_in_path(get("WALK_IN_PATH")),
        start_path=_start_path(get("START_PATH")),
        browser_channel=_browser_channel(get("BROWSER_CHANNEL"), platform),
        card_reader_name=get("CARD_READER_NAME") or None,
        keep_login=_keep_login(get("KEEP_LOGIN")),
        poll_interval=_poll_interval(get("POLL_INTERVAL")),
        printer_name=get("PRINTER_NAME")
        or (WINDOWS_PRINTER_NAME if platform.startswith("win") else CUPS_PRINTER_NAME),
    )


def save_shelter_url(env_path: Path, origin: str) -> None:
    """Write SHELTER_URL into `env_path` (created if missing), keeping every other line."""
    env_path.touch(exist_ok=True)
    set_key(env_path, "SHELTER_URL", origin, quote_mode="never")
