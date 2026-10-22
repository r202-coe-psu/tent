import ipaddress
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Config:
    base_url: str
    device_id: str
    device_secret: str
    printer_name: str
    ppi: int = 203
    job_timeout_sec: int = 30
    idle_backoff_sec: int = 5
    error_backoff_max_sec: int = 60
    boot_slip: bool = True


def _required(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"{name} is required")
    return value


def _is_trusted_plaintext_host(hostname: str) -> bool:
    """Plain HTTP is only allowed to loopback / private-LAN hosts; a DNS name must use HTTPS."""
    if hostname == "localhost":
        return True
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local


def _base_url(environ: Mapping[str, str]) -> str:
    value = _required(environ, "TENT_BASE_URL")
    parts = urlsplit(value)
    hostname = (parts.hostname or "").lower()
    if parts.scheme == "https" and hostname:
        return value.rstrip("/")
    if parts.scheme == "http" and _is_trusted_plaintext_host(hostname):
        return value.rstrip("/")
    raise ConfigError(
        "TENT_BASE_URL must be https://, or http:// only for localhost / private-LAN hosts"
    )


def _positive_int(environ: Mapping[str, str], name: str, default: int) -> int:
    raw = environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a positive integer") from None
    if value <= 0:
        raise ConfigError(f"{name} must be a positive integer")
    return value


_TRUE_WORDS = frozenset({"1", "true", "yes"})
_FALSE_WORDS = frozenset({"0", "false", "no"})


def _boolean(environ: Mapping[str, str], name: str, default: bool) -> bool:
    raw = environ.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in _TRUE_WORDS:
        return True
    if raw in _FALSE_WORDS:
        return False
    raise ConfigError(f"{name} must be one of 1/0/true/false/yes/no")


def load_config(environ: Mapping[str, str]) -> Config:
    return Config(
        base_url=_base_url(environ),
        device_id=_required(environ, "DEVICE_ID"),
        device_secret=_required(environ, "DEVICE_SECRET"),
        printer_name=environ.get("PRINTER_NAME", "").strip() or "tent_xprinter",
        ppi=_positive_int(environ, "PRINT_PPI", 203),
        job_timeout_sec=_positive_int(environ, "PRINT_JOB_TIMEOUT_SEC", 30),
        idle_backoff_sec=_positive_int(environ, "IDLE_BACKOFF_SEC", 5),
        error_backoff_max_sec=_positive_int(environ, "ERROR_BACKOFF_MAX_SEC", 60),
        boot_slip=_boolean(environ, "BOOT_SLIP", True),
    )
