import os
from pathlib import Path
from typing import Mapping, Any
from urllib.parse import urlparse

try:
    from dotenv import dotenv_values
except ImportError:  # pragma: no cover - production installs python-dotenv
    def dotenv_values(path: Path) -> dict[str, str]:
        values: dict[str, str] = {}
        if not path.exists():
            return values
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
        return values


class ScannerConfigError(ValueError):
    """A safe, operator-facing configuration error with no secret values."""


PLACEHOLDER_VALUES = {
    "",
    "changeme",
    "change-me",
    "example",
    "example-secret",
    "kiosk-test",
    "kiosk-test-secret",
    "kisok-test-secret",
    "your-device-id",
    "your-device-secret",
    "replace-me",
    "replace_me",
    "<device-id>",
    "<one-time-key>",
}

TRUE_VALUES = frozenset({"true", "1", "yes", "on"})
FALSE_VALUES = frozenset({"false", "0", "no", "off"})
PHONE_CHECK_IN_DEFAULT = True
PHONE_CHECK_IN_OFF_VALUE = "off"  # FR-KPT-05 wire contract with kiosk display context.


def load_config(
    env_path: str | os.PathLike[str] = ".env",
    environ: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Load .env as defaults, then let process environment override it."""

    file_values = {
        key: value
        for key, value in dotenv_values(Path(env_path)).items()
        if value is not None
    }
    process_values = dict(os.environ if environ is None else environ)
    return {**file_values, **process_values}


def _clean(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def parse_bool_setting(config: Mapping[str, Any], key: str, default: bool) -> bool:
    raw = _clean(config.get(key)).lower()
    if not raw:
        return default
    if raw in TRUE_VALUES:
        return True
    if raw in FALSE_VALUES:
        return False
    raise ScannerConfigError(f"{key} must be true or false")


def _is_placeholder(value: str) -> bool:
    lowered = value.lower()
    return (
        lowered in PLACEHOLDER_VALUES
        or "<one-time" in lowered
        or "your-" in lowered
        or "replace" in lowered
        or lowered.startswith("example")
    )


def validate_config(config: Mapping[str, Any]) -> dict[str, Any]:
    """Validate required scanner credentials before browser or reader startup."""

    base_url = _clean(config.get("TENT_BASE_URL")).rstrip("/")
    device_id = _clean(config.get("DEVICE_ID"))
    device_secret = _clean(config.get("DEVICE_SECRET"))

    if not base_url:
        raise ScannerConfigError("TENT_BASE_URL is required")
    if not device_id or _is_placeholder(device_id):
        raise ScannerConfigError("DEVICE_ID is missing or still uses a placeholder")
    if not device_secret or _is_placeholder(device_secret) or device_secret.endswith("<one-time-key>"):
        raise ScannerConfigError("DEVICE_SECRET is missing or still uses a placeholder")

    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or not parsed.hostname:
        raise ScannerConfigError("TENT_BASE_URL must be an absolute HTTP(S) URL")
    if _is_placeholder(parsed.hostname or "") or "<" in (parsed.hostname or ""):
        raise ScannerConfigError("TENT_BASE_URL is still a placeholder")
    validated = dict(config)
    validated.update(
        {
            "TENT_BASE_URL": base_url,
            "DEVICE_ID": device_id,
            "DEVICE_SECRET": device_secret,
            "KIOSK_PHONE_CHECK_IN_ENABLED": parse_bool_setting(
                config, "KIOSK_PHONE_CHECK_IN_ENABLED", default=PHONE_CHECK_IN_DEFAULT
            ),
        }
    )
    return validated


def load_and_validate_config(
    env_path: str | os.PathLike[str] = ".env",
    environ: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    return validate_config(load_config(env_path, environ))
