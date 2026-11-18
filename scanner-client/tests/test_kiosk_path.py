import os
import subprocess
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def test_card_session_imports_from_source_without_pythonpath():
    env = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}

    result = subprocess.run(
        # -P: keep the cwd off sys.path so `app.scard` cannot come from pytest's pythonpath
        # or from the working directory; only the package itself may put kiosk/ on the path.
        [sys.executable, "-P", "-c", "import scanner_client.card_session"],
        cwd=PACKAGE_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr
