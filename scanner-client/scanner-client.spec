# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for scanner-client (issue #1326). Build on Windows (no cross-compile):
#   uv run --group build pyinstaller scanner-client.spec --noconfirm
# SCANNER_CLIENT_DEBUG=1 builds `scanner-client-debug` with a console window (console=True).
import os

from PyInstaller.utils.hooks import collect_data_files

HERE = os.path.abspath(SPECPATH)
DEBUG = os.environ.get("SCANNER_CLIENT_DEBUG", "").strip().lower() in ("1", "true", "yes")
NAME = "scanner-client-debug" if DEBUG else "scanner-client"

# PyInstaller (+ hooks-contrib) ships no hook for playwright, so the driver (a bundled node
# runtime + the playwright JS package under playwright/driver) must be collected explicitly.
# Chromium itself is NOT bundled: the app drives the installed Edge via Playwright `channel`.
datas = collect_data_files("playwright")

a = Analysis(
    [os.path.join(HERE, "scanner_client", "main.py")],
    # '../kiosk' provides app.scard, the same card reader module the kiosk uses.
    pathex=[HERE, os.path.join(HERE, "..", "kiosk")],
    binaries=[],
    datas=datas,
    hiddenimports=["app.scard"],
    hookspath=[],
    runtime_hooks=[],
    # scard must not pull in face/print dependencies; none are used here.
    excludes=["cv2", "numpy", "PIL", "tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # onedir (COLLECT below), not onefile
    name=NAME,
    debug=False,
    strip=False,
    upx=False,  # UPX-packed binaries trip antivirus more often
    console=DEBUG,
    icon=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name=NAME,
)
