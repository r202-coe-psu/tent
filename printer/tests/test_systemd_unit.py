from pathlib import Path

UNIT = Path(__file__).parent.parent / "systemd" / "tent-printer.service"


def test_unit_gives_the_agent_time_to_finish_a_job_after_sigterm():
    assert "TimeoutStopSec=60" in UNIT.read_text().splitlines()
