import re
import subprocess
from pathlib import Path

import pytest

from printer.runner import REPORT_RESERVE_SEC, _print_deadline

ROOT = Path(__file__).parent.parent
UNIT = ROOT / "systemd" / "tent-printer.service"
AUTOSTART = ROOT / "setup_autostart.sh"

# Server lease for a job (frontend print-job-timing.ts leaseSecFor): 90 s + 5 s per label,
# at most 20 labels per job. SIGTERM only sets a flag, so systemd must wait out that whole job.
MAX_LABELS_PER_JOB = 20
MAX_LEASE_SEC = 90 + 5 * MAX_LABELS_PER_JOB
CONFIG_ERROR_EXIT_CODE = 2


def _autostart_unit_text(tmp_path: Path) -> str:
    folder = tmp_path / "printer"
    folder.mkdir()
    (folder / "setup_autostart.sh").write_text(AUTOSTART.read_text())
    (folder / ".env").write_text("DEVICE_SECRET=x\n")
    result = subprocess.run(
        ["bash", str(folder / "setup_autostart.sh"), "--dry-run"],
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin", "HOME": str(folder), "USER": "printer"},
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


@pytest.fixture(params=["shipped", "autostart"])
def unit_text(request, tmp_path) -> str:
    return UNIT.read_text() if request.param == "shipped" else _autostart_unit_text(tmp_path)


def _setting(text: str, name: str) -> str:
    match = re.search(rf"^{name}=(.+)$", text, re.MULTILINE)
    assert match, f"{name} missing from unit"
    return match.group(1).strip()


def test_unit_gives_the_agent_time_to_finish_a_job_after_sigterm(unit_text):
    job_end = max(_print_deadline(0, MAX_LEASE_SEC), MAX_LEASE_SEC)  # print, then the report
    needed = job_end + REPORT_RESERVE_SEC

    assert int(_setting(unit_text, "TimeoutStopSec")) >= needed


def test_unit_does_not_restart_loop_on_a_config_error(unit_text):
    assert _setting(unit_text, "RestartPreventExitStatus") == str(CONFIG_ERROR_EXIT_CODE)
