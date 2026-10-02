import ipaddress
import os
import re
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

LOOPBACK_HOSTNAMES = {"localhost"}

USB_ID_PATTERN = re.compile(r"[0-9a-fA-F]{4}:[0-9a-fA-F]{4}")
PRINTER_BACKENDS = ("cups", "escpos")
PRINTER_WIDTH_RANGE = (384, 832)
DEFAULT_PRINTER_WIDTH_DOTS = 576
PRINTER_CUT_FEED_RANGE_MM = (0, 40)
# kiosk3 cuts cleanly with no extra feed (see app.escpos.ESC_FEED).
DEFAULT_PRINTER_CUT_FEED_MM = 0
KIOSK_QR_INPUTS = ("camera", "reader", "both")
QR_READER_GAP_RANGE_MS = (10, 100)
DEFAULT_QR_READER_GAP_MS = 50
CARD_READERS = ("pcsc", "rfpro")
DEFAULT_CARD_READER_USB_ID = "0483:4c43"


def _is_trusted_plaintext_host(hostname: str) -> bool:
    """HTTP is only auto-allowed for loopback / private-LAN hosts — the on-site edge
    fallback and dev boxes. A DNS hostname (e.g. a public domain) must use HTTPS unless
    ALLOW_INSECURE_HTTP is set, so a typo'd scheme cannot silently send the device secret,
    citizen IDs and photos in cleartext on a network that is not actually private."""
    if hostname in LOOPBACK_HOSTNAMES:
        return True
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local


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


def _is_placeholder(value: str) -> bool:
    lowered = value.lower()
    return (
        lowered in PLACEHOLDER_VALUES
        or "<one-time" in lowered
        or "your-" in lowered
        or "replace" in lowered
        or lowered.startswith("example")
    )


def _choice(config: Mapping[str, Any], key: str, allowed: tuple[str, ...], default: str) -> str:
    value = _clean(config.get(key)).lower() or default
    if value not in allowed:
        raise ScannerConfigError(f"{key} must be one of: {', '.join(allowed)}")
    return value


def _usb_id(config: Mapping[str, Any], key: str, default: str = "") -> str:
    value = _clean(config.get(key)) or default
    if value and not USB_ID_PATTERN.fullmatch(value):
        raise ScannerConfigError(f"{key} must look like VID:PID in hex, e.g. 0483:4c43")
    return value.lower()


def _bounded_int(
    config: Mapping[str, Any], key: str, default: int, bounds: tuple[int, int]
) -> int:
    raw = _clean(config.get(key))
    try:
        value = int(raw) if raw else default
    except ValueError:
        raise ScannerConfigError(f"{key} must be an integer") from None
    if not bounds[0] <= value <= bounds[1]:
        raise ScannerConfigError(f"{key} must be between {bounds[0]} and {bounds[1]}")
    return value


def validate_hardware_config(config: Mapping[str, Any]) -> dict[str, str]:
    """Validate per-machine printer / QR reader / card reader settings.

    Unset keys keep the original Raspberry Pi behaviour (CUPS, camera, PC/SC). Returns the
    normalised values to merge into the config; messages name keys only, never values.
    """

    backend = _choice(config, "PRINTER_BACKEND", PRINTER_BACKENDS, "cups")
    printer_usb_id = _usb_id(config, "PRINTER_USB_ID")
    printer_device = _clean(config.get("PRINTER_DEVICE"))
    width_dots = _bounded_int(
        config, "PRINTER_WIDTH_DOTS", DEFAULT_PRINTER_WIDTH_DOTS, PRINTER_WIDTH_RANGE
    )
    if width_dots % 8:
        raise ScannerConfigError("PRINTER_WIDTH_DOTS must be a multiple of 8")
    cut_feed_mm = _bounded_int(
        config, "PRINTER_CUT_FEED_MM", DEFAULT_PRINTER_CUT_FEED_MM, PRINTER_CUT_FEED_RANGE_MM
    )
    if backend == "escpos" and not (printer_usb_id or printer_device):
        raise ScannerConfigError(
            "PRINTER_BACKEND=escpos requires PRINTER_USB_ID or PRINTER_DEVICE"
        )

    qr_input = _choice(config, "KIOSK_QR_INPUT", KIOSK_QR_INPUTS, "camera")
    reader_gap_ms = _bounded_int(
        config, "KIOSK_QR_READER_MAX_GAP_MS", DEFAULT_QR_READER_GAP_MS, QR_READER_GAP_RANGE_MS
    )

    card_reader = _choice(config, "CARD_READER", CARD_READERS, "pcsc")
    card_reader_usb_id = _usb_id(config, "CARD_READER_USB_ID", DEFAULT_CARD_READER_USB_ID)

    return {
        "PRINTER_BACKEND": backend,
        "PRINTER_USB_ID": printer_usb_id,
        "PRINTER_DEVICE": printer_device,
        "PRINTER_WIDTH_DOTS": str(width_dots),
        "PRINTER_CUT_FEED_MM": str(cut_feed_mm),
        "KIOSK_QR_INPUT": qr_input,
        "KIOSK_CAMERA_LABEL": _clean(config.get("KIOSK_CAMERA_LABEL")),
        "KIOSK_QR_READER_MAX_GAP_MS": str(reader_gap_ms),
        "CARD_READER": card_reader,
        "CARD_READER_USB_ID": card_reader_usb_id,
    }


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
    allow_insecure_http = _clean(config.get("ALLOW_INSECURE_HTTP")).lower() in ("1", "true", "yes")
    if (
        parsed.scheme == "http"
        and not _is_trusted_plaintext_host(parsed.hostname)
        and not allow_insecure_http
    ):
        raise ScannerConfigError(
            "TENT_BASE_URL must use HTTPS for a named host "
            "(set ALLOW_INSECURE_HTTP=true only for a trusted internal network)"
        )
    validated = dict(config)
    validated.update(
        {
            "TENT_BASE_URL": base_url,
            "DEVICE_ID": device_id,
            "DEVICE_SECRET": device_secret,
            **validate_hardware_config(config),
        }
    )
    return validated


def load_and_validate_config(
    env_path: str | os.PathLike[str] = ".env",
    environ: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    return validate_config(load_config(env_path, environ))
