"""setup_autostart.sh runs under --dry-run: mutating commands are printed, not run."""

import stat
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
def fake_bin(tmp_path) -> Path:
    """`systemctl` stand-in: `is-active|is-enabled tent-printer[.service]` succeeds only for FAKE_PRODUCTION."""
    directory = tmp_path / "bin"
    directory.mkdir()
    fake_systemctl = directory / "systemctl"
    fake_systemctl.write_text(
        "#!/bin/sh\n"
        'for arg; do last="$arg"; done\n'
        '{ [ "$last" = tent-printer ] || [ "$last" = tent-printer.service ]; } '
        '&& [ "$1" = "${FAKE_PRODUCTION:-none}" ]\n'
    )
    fake_systemctl.chmod(fake_systemctl.stat().st_mode | stat.S_IXUSR)
    # `fc-list :lang=th` lists a Thai font only when FAKE_THAI_FONT=1.
    fake_fc_list = directory / "fc-list"
    fake_fc_list.write_text(
        '#!/bin/sh\n[ "${FAKE_THAI_FONT:-0}" = 1 ] && echo /usr/share/fonts/tlwg/Loma.ttf\nexit 0\n'
    )
    fake_fc_list.chmod(fake_fc_list.stat().st_mode | stat.S_IXUSR)
    return directory


@pytest.fixture
def setup(agent_dir, fake_bin):
    def run(*args: str, env: dict[str, str] | None = None):
        return subprocess.run(
            ["bash", str(agent_dir / "setup_autostart.sh"), "--dry-run", *args],
            capture_output=True,
            text=True,
            env={
                "PATH": f"{fake_bin}:/usr/bin:/bin",
                "HOME": str(agent_dir),
                "USER": "printer",
                **(env or {}),
            },
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

    assert steps.index(f"{agent_dir}/run.sh --setup") < steps.index(f"sudo systemctl enable {UNIT}")
    assert "sudo systemctl daemon-reload" in steps


def test_install_restarts_the_agent_so_a_rerun_picks_up_new_code(setup):
    steps = planned(setup())

    # restart also starts a stopped unit, so one command covers first install and updates.
    assert steps.index(f"sudo systemctl enable {UNIT}") < steps.index(
        f"sudo systemctl restart {UNIT}"
    )
    assert f"sudo systemctl enable --now {UNIT}" not in steps


@pytest.mark.parametrize("state", ["is-active", "is-enabled"])
def test_install_is_refused_while_the_production_agent_is_installed(setup, state):
    result = setup(env={"FAKE_PRODUCTION": state})

    assert result.returncode != 0
    assert "tent-printer.service" in result.stderr
    assert "systemctl disable --now tent-printer" in result.stderr
    assert planned(result) == []


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


INSTALL_THAI_FONT = "sudo apt-get install -y fonts-thai-tlwg"


def test_installs_a_thai_font_for_the_boot_slip_when_none_is_present(setup):
    result = setup(env={"FAKE_THAI_FONT": "0"})

    assert result.returncode == 0, result.stderr
    assert INSTALL_THAI_FONT in planned(result)


def test_skips_the_thai_font_when_one_is_installed(setup):
    result = setup(env={"FAKE_THAI_FONT": "1"})

    assert result.returncode == 0, result.stderr
    assert INSTALL_THAI_FONT not in planned(result)


def test_package_index_is_refreshed_once_before_the_thai_font_install(setup):
    plan = planned(setup(env={"FAKE_THAI_FONT": "0"}))

    assert plan.count("sudo apt-get update") == 1
    assert plan.index("sudo apt-get update") < plan.index(INSTALL_THAI_FONT)


def test_package_index_is_not_refreshed_when_the_thai_font_is_already_there(setup):
    plan = planned(setup(env={"FAKE_THAI_FONT": "1"}))

    assert "sudo apt-get update" not in plan


def test_pillow_raqm_support_is_checked_in_the_venv_after_deps_are_installed(setup, agent_dir):
    plan = planned(setup())

    install = plan.index(f"{agent_dir}/run.sh --setup")
    check = next(
        i
        for i, command in enumerate(plan)
        if command.startswith(f"{agent_dir}/.venv/bin/python -c") and "raqm" in command
    )
    assert install < check


@pytest.fixture
def real_run(agent_dir, fake_bin):
    """Real (non --dry-run) install with sudo, run.sh and the venv python faked out."""
    (agent_dir / "run.sh").write_text("#!/bin/sh\nexit 0\n")
    (agent_dir / "run.sh").chmod(0o755)
    venv_python = agent_dir / ".venv" / "bin" / "python"
    venv_python.parent.mkdir(parents=True)
    venv_python.write_text("#!/bin/sh\nexit ${FAKE_RAQM_EXIT:-0}\n")
    venv_python.chmod(0o755)
    # sudo: apt-get fails (exit 100) when FAKE_APT_FAILS=1; everything else is a no-op (tee eats stdin).
    sudo = fake_bin / "sudo"
    sudo.write_text(
        '#!/bin/sh\n[ "$1" = apt-get ] && [ "${FAKE_APT_FAILS:-0}" = 1 ] && exit 100\n[ "$1" = tee ] && cat >/dev/null\nexit 0\n'
    )
    sudo.chmod(0o755)

    def run(env: dict[str, str]):
        return subprocess.run(
            ["bash", str(agent_dir / "setup_autostart.sh")],
            capture_output=True,
            text=True,
            env={
                "PATH": f"{fake_bin}:/usr/bin:/bin",
                "HOME": str(agent_dir),
                "USER": "printer",
                **env,
            },
        )

    return run


def test_failing_thai_font_install_only_warns_and_the_install_carries_on(real_run):
    result = real_run({"FAKE_THAI_FONT": "0", "FAKE_APT_FAILS": "1"})

    assert result.returncode == 0, result.stderr
    assert "fonts-thai-tlwg" in result.stdout
    assert "ตั้งค่า autostart แล้ว" in result.stdout


def test_missing_raqm_warns_how_to_fix_but_does_not_abort(real_run):
    result = real_run({"FAKE_THAI_FONT": "1", "FAKE_RAQM_EXIT": "1"})

    assert result.returncode == 0, result.stderr
    assert "libraqm0" in result.stdout
    assert "ตั้งค่า autostart แล้ว" in result.stdout


def test_present_raqm_prints_no_warning(real_run):
    result = real_run({"FAKE_THAI_FONT": "1", "FAKE_RAQM_EXIT": "0"})

    assert result.returncode == 0, result.stderr
    assert "libraqm0" not in result.stdout
