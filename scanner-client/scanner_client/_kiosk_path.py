"""Make the shared kiosk module (`app.scard`) importable when running from source."""

import sys
from pathlib import Path

KIOSK_DIR = Path(__file__).resolve().parent.parent.parent / "kiosk"


def ensure_kiosk_on_path() -> None:
    """Put `<repo>/kiosk` on sys.path unless frozen (PyInstaller bundles app.scard itself)."""
    if getattr(sys, "frozen", False):
        return
    entry = str(KIOSK_DIR)
    if entry not in sys.path:
        sys.path.append(entry)
