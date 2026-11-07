"""setup_printer_server.sh runs under --dry-run: mutating commands are printed, not run."""

import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "setup_printer_server.sh"
FAKE_SECRET = "sk_print_FAKE_TOPSECRET_123"
DRY = "[dry-run] "

ENV_TEXT = f"""TENT_BASE_URL=https://tent.example.org
DEVICE_ID=printer-sh001-reg1
DEVICE_SECRET={FAKE_SECRET}
PRINTER_NAME=tent_xprinter
"""


@pytest.fixture
def env_file(tmp_path) -> Path:
    path = tmp_path / "printer.env"
    path.write_text(ENV_TEXT)
    return path


@pytest.fixture
def fake_bin(tmp_path) -> Path:
    """`id` stand-in: user tent-printer does not exist unless FAKE_USER_EXISTS=1."""
    directory = tmp_path / "bin"
    directory.mkdir()
    fake_id = directory / "id"
    fake_id.write_text('#!/bin/sh\n[ "${FAKE_USER_EXISTS:-0}" = 1 ]\n')
    fake_id.chmod(fake_id.stat().st_mode | stat.S_IXUSR)
    # `systemctl is-active|is-enabled tent-printer-autostart` succeeds only when
    # FAKE_AUTOSTART is that verb; every other systemctl call fails quietly.
    fake_systemctl = directory / "systemctl"
    fake_systemctl.write_text(
        '#!/bin/sh\n'
        'for arg; do last="$arg"; done\n'
        '[ "$last" = tent-printer-autostart ] && [ "$1" = "${FAKE_AUTOSTART:-none}" ]\n'
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
def setup(fake_bin, env_file):
    def run(*args: str, env: dict[str, str] | None = None, with_env_file: bool = True):
        argv = ["bash", str(SCRIPT), "--dry-run", *args]
        if with_env_file:
            argv += ["--env-file", str(env_file)]
        return subprocess.run(
            argv,
            capture_output=True,
            text=True,
            env={"PATH": f"{fake_bin}:/usr/bin:/bin", "HOME": str(fake_bin), **(env or {})},
        )

    return run


def planned(result: subprocess.CompletedProcess) -> list[str]:
    return [line[len(DRY) :] for line in result.stdout.splitlines() if line.startswith(DRY)]


def test_sets_abort_job_error_policy_on_the_queue(setup):
    result = setup()

    assert result.returncode == 0, result.stderr
    assert "lpadmin -p tent_xprinter -o printer-error-policy=abort-job" in planned(result)


def test_allow_cupsenable_is_rejected_and_plans_nothing(setup):
    result = setup("--allow-cupsenable")

    assert result.returncode != 0
    assert "lpadmin" in result.stderr
    assert planned(result) == []


def test_cupsenable_rights_are_not_granted_by_default(setup):
    result = setup()

    assert not any("lpadmin tent-printer" in command for command in planned(result))
    assert not any(command.startswith("usermod") for command in planned(result))


@pytest.mark.parametrize("state", ["is-active", "is-enabled"])
def test_install_is_refused_while_the_autostart_agent_is_installed(setup, state):
    result = setup(env={"FAKE_AUTOSTART": state})

    assert result.returncode != 0
    assert "tent-printer-autostart" in result.stderr
    assert "setup_autostart.sh --disable" in result.stderr
    assert planned(result) == []


def test_install_proceeds_when_the_autostart_agent_is_absent(setup):
    result = setup()

    assert result.returncode == 0
    assert "systemctl enable --now tent-printer" in planned(result)


def test_missing_env_file_option_fails_with_a_clear_message_and_plans_nothing(setup, tmp_path):
    result = setup("--prefix", str(tmp_path / "empty"), with_env_file=False)

    assert result.returncode != 0
    assert "--env-file" in result.stderr
    assert planned(result) == []


def test_env_file_that_does_not_exist_is_refused(setup, tmp_path):
    result = setup("--prefix", str(tmp_path / "empty"), with_env_file=False, env=None)
    assert result.returncode != 0

    missing = tmp_path / "nope.env"
    result = setup("--env-file", str(missing), with_env_file=False)

    assert result.returncode != 0
    assert str(missing) in result.stderr
    assert planned(result) == []


@pytest.mark.parametrize("queue", ["bad name", "q;rm -rf /", "a/b", "$(id)", "", "my.queue", "-q"])
def test_invalid_queue_name_is_rejected_before_anything_is_planned(setup, queue):
    result = setup("--queue", queue)

    assert result.returncode != 0
    assert "queue" in result.stderr
    assert planned(result) == []


def test_queue_name_comes_from_printer_name_in_the_env_file_and_is_validated(setup, env_file):
    env_file.write_text(ENV_TEXT.replace("PRINTER_NAME=tent_xprinter", 'PRINTER_NAME="my_queue-2"'))
    result = setup()
    assert "lpadmin -p my_queue-2 -o printer-error-policy=abort-job" in planned(result)

    env_file.write_text(ENV_TEXT.replace("PRINTER_NAME=tent_xprinter", "PRINTER_NAME=bad name"))
    result = setup()
    assert result.returncode != 0
    assert "queue" in result.stderr


def test_queue_option_overrides_the_env_file_and_defaults_to_tent_xprinter(setup, env_file):
    result = setup("--queue", "label_q")
    assert "lpadmin -p label_q -o printer-error-policy=abort-job" in planned(result)

    env_file.write_text(ENV_TEXT.replace("PRINTER_NAME=tent_xprinter\n", ""))
    result = setup()
    assert "lpadmin -p tent_xprinter -o printer-error-policy=abort-job" in planned(result)


def test_env_file_contents_are_never_printed(setup):
    result = setup()

    assert result.returncode == 0, result.stderr
    assert FAKE_SECRET not in result.stdout
    assert FAKE_SECRET not in result.stderr


def test_missing_service_user_is_created_as_a_system_user_in_group_lp(setup):
    result = setup()

    assert (
        "useradd --system --gid lp --no-create-home --shell /usr/sbin/nologin tent-printer"
        in planned(result)
    )


def test_existing_service_user_is_not_created_again(setup):
    result = setup(env={"FAKE_USER_EXISTS": "1"})

    assert not any(command.startswith("useradd") for command in planned(result))


def test_project_is_synced_to_the_prefix_without_dev_scripts_and_deps_are_frozen(setup):
    result = setup("--prefix", "/srv/tent/printer")
    plan = planned(result)

    sync = next(command for command in plan if command.startswith("rsync"))
    assert sync.endswith("/printer/ /srv/tent/printer/printer/")
    assert "--delete" in sync
    assert "install -D -m 0644" in " ".join(plan)
    assert not any("scripts" in command for command in plan)
    uv_sync = next(command for command in plan if command.startswith("uv sync"))
    assert "--frozen" in uv_sync
    assert "--no-dev" in uv_sync
    assert "--project /srv/tent/printer" in uv_sync


def test_env_file_is_installed_owned_by_the_service_user_with_mode_600(setup, env_file):
    result = setup()

    assert f"install -m 600 -o tent-printer -g lp {env_file} /opt/tent/printer/.env" in planned(
        result
    )


def test_unit_is_installed_with_the_prefix_then_enabled_and_started(setup, tmp_path):
    unit_dir = tmp_path / "units"

    result = setup(
        "--prefix", "/srv/tent/printer", "--unit-dir", str(unit_dir)
    )
    plan = planned(result)

    unit = next(
        i for i, command in enumerate(plan) if f"{unit_dir}/tent-printer.service" in command
    )
    assert "/srv/tent/printer" in plan[unit]
    assert plan.index("systemctl daemon-reload") > unit
    assert plan.index("systemctl enable --now tent-printer") > plan.index("systemctl daemon-reload")


def test_steps_run_in_install_order(setup):
    result = setup()
    plan = planned(result)

    def at(prefix: str) -> int:
        return next(i for i, command in enumerate(plan) if command.startswith(prefix))

    assert (
        at("useradd")
        < at("rsync")
        < at("uv sync")
        < at("install -m 600")
        < at("lpadmin -p")
        < at("sed")
        < at("systemctl daemon-reload")
        < at("systemctl enable")
    )


def write_fake(directory: Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(f"#!/bin/sh\n{body}\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def test_status_shows_unit_state_queue_state_and_last_five_log_lines_without_changing_anything(
    fake_bin,
):
    write_fake(fake_bin, "systemctl", 'echo "systemctl $*"; echo active')
    write_fake(fake_bin, "lpstat", 'echo "lpstat $* LC_ALL=$LC_ALL"; echo "printer q is idle."')
    write_fake(fake_bin, "journalctl", 'echo "journalctl $*"; echo "agent log line"')
    for mutating in ("useradd", "usermod", "lpadmin", "rsync", "uv", "install"):
        write_fake(fake_bin, mutating, f'echo "MUTATED {mutating}"; exit 1')

    result = subprocess.run(
        ["bash", str(SCRIPT), "--status", "--queue", "label_q"],
        capture_output=True,
        text=True,
        env={"PATH": f"{fake_bin}:/usr/bin:/bin", "HOME": str(fake_bin)},
    )

    assert result.returncode == 0, result.stderr
    assert "systemctl is-active tent-printer" in result.stdout
    assert "lpstat -p label_q LC_ALL=C" in result.stdout
    assert "printer q is idle." in result.stdout
    assert "journalctl -u tent-printer -n 5 --no-pager" in result.stdout
    assert "agent log line" in result.stdout
    assert "MUTATED" not in result.stdout
    assert DRY not in result.stdout


def test_rerun_with_the_installed_env_file_fixes_owner_and_mode_instead_of_copying_onto_itself(
    setup, tmp_path
):
    prefix = tmp_path / "opt" / "printer"
    prefix.mkdir(parents=True)
    installed = prefix / ".env"
    installed.write_text(ENV_TEXT)

    result = setup(
        "--prefix",
        str(prefix),
        "--env-file",
        str(installed),
        with_env_file=False,
    )
    plan = planned(result)

    assert result.returncode == 0, result.stderr
    assert f"chown tent-printer:lp {installed}" in plan
    assert f"chmod 600 {installed}" in plan
    assert not any(command.startswith("install -m 600") for command in plan)


def test_rerun_without_env_file_reuses_the_installed_one(setup, tmp_path):
    prefix = tmp_path / "opt" / "printer"
    prefix.mkdir(parents=True)
    installed = prefix / ".env"
    installed.write_text(ENV_TEXT)

    result = setup("--prefix", str(prefix), with_env_file=False)
    plan = planned(result)

    assert result.returncode == 0, result.stderr
    assert f"chown tent-printer:lp {installed}" in plan
    assert "systemctl enable --now tent-printer" in plan


INSTALL_THAI_FONT = "apt-get install -y fonts-thai-tlwg"


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

    assert plan.count("apt-get update") == 1
    assert plan.index("apt-get update") < plan.index(INSTALL_THAI_FONT)


def test_package_index_is_not_refreshed_when_the_thai_font_is_already_there(setup):
    plan = planned(setup(env={"FAKE_THAI_FONT": "1"}))

    assert "apt-get update" not in plan


def test_pillow_raqm_support_is_checked_in_the_installed_venv_after_deps_are_synced(setup):
    plan = planned(setup("--prefix", "/srv/tent/printer"))

    sync = next(i for i, command in enumerate(plan) if command.startswith("uv sync"))
    check = next(
        i
        for i, command in enumerate(plan)
        if command.startswith("/srv/tent/printer/.venv/bin/python -c") and "raqm" in command
    )
    assert sync < check
