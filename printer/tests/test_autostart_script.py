"""setup_autostart.sh runs under --dry-run: mutating commands are printed, not run."""

import subprocess
from pathlib import Path

import pytest

SOURCE = Path(__file__).resolve().parent.parent / "setup_autostart.sh"
UNIT = "tent-printer-autostart.service"
DRY = "[dry-run] "


@pytest.fixture
def agent_dir(tmp_path) -> Path:
    """A copy of the script in a scratch agent folder, so .env presence is under test control."""
    directory = tmp_path / "printer"
    directory.mkdir()
    (directory / "setup_autostart.sh").write_text(SOURCE.read_text())
    (directory / ".env").write_text("DEVICE_SECRET=sk_print_FAKE_TOPSECRET_123\n")
    return directory


@pytest.fixture
def setup(agent_dir):
    def run(*args: str):
        return subprocess.run(
            ["bash", str(agent_dir / "setup_autostart.sh"), "--dry-run", *args],
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(agent_dir), "USER": "printer"},
        )

    return run


def planned(result: subprocess.CompletedProcess) -> list[str]:
    return [line[len(DRY) :] for line in result.stdout.splitlines() if line.startswith(DRY)]


def test_install_writes_a_unit_that_runs_run_sh_as_the_current_user(setup, agent_dir):
    result = setup()

    assert result.returncode == 0, result.stderr
    assert f"ExecStart={agent_dir}/run.sh" in result.stdout
    assert f"WorkingDirectory={agent_dir}" in result.stdout
    assert "User=printer" in result.stdout
    assert "Restart=always" in result.stdout
    assert "WantedBy=multi-user.target" in result.stdout


def test_install_prepares_the_venv_then_enables_the_unit_at_boot(setup, agent_dir):
    steps = planned(setup())

    assert steps.index(f"{agent_dir}/run.sh --setup") < steps.index(
        f"sudo systemctl enable --now {UNIT}"
    )
    assert "sudo systemctl daemon-reload" in steps


def test_install_refuses_without_env_file(setup, agent_dir):
    (agent_dir / ".env").unlink()

    result = setup()

    assert result.returncode != 0
    assert ".env" in result.stderr
    assert planned(result) == []


def test_disable_stops_the_unit_and_removes_it(setup):
    steps = planned(setup("--disable"))

    assert f"sudo systemctl disable --now {UNIT}" in steps
    assert f"sudo rm -f /etc/systemd/system/{UNIT}" in steps


def test_output_never_contains_the_device_secret(setup):
    for args in ((), ("--disable",), ("--status",)):
        result = setup(*args)
        assert "TOPSECRET" not in result.stdout + result.stderr


def test_unknown_option_fails(setup):
    result = setup("--bogus")

    assert result.returncode != 0
    assert planned(result) == []
