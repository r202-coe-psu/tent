"""Start the client from tent.exe in the zip build (issue #1326).

Smart App Control blocks every .exe we build, so the zip ships python.org's PSF-signed
pythonw.exe renamed to tent.exe. Double-clicked, it starts with no arguments; the `site` module
then imports sitecustomize.py, which calls `launch()` to run the client. Any other start
(python.exe, `-m`, `-c`) goes on as plain Python.
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Callable, Sequence
from pathlib import PureWindowsPath

LAUNCHER_NAME = "tent"


def should_launch(executable: str, orig_argv: Sequence[str]) -> bool:
    return PureWindowsPath(executable).stem.lower() == LAUNCHER_NAME and len(orig_argv) == 1


def _run_client() -> int:
    from scanner_client.main import main

    return main()


def launch(
    executable: str = sys.executable,
    orig_argv: Sequence[str] = sys.orig_argv,
    *,
    run: Callable[[], int] = _run_client,
    exit_: Callable[[int], object] = os._exit,
) -> None:
    """Run the client and end the process; returns only when this is not a tent.exe start.

    It runs while `site` is still being imported, where SystemExit would be a fatal startup
    error, so it ends the process with os._exit after flushing the log instead.
    """
    if not should_launch(executable, orig_argv):
        return
    code = 1
    try:
        code = run()
    except BaseException:  # the client logs its own errors; just never fall through to a REPL
        pass
    finally:
        logging.shutdown()
        exit_(code)
