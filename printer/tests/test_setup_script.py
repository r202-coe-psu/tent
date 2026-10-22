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


def test_standalone_host_sets_abort_job_error_policy_on_the_queue(setup):
    result = setup("--host-kind", "standalone")

    assert result.returncode == 0, result.stderr
    assert "lpadmin -p tent_xprinter -o printer-error-policy=abort-job" in planned(result)


def test_kiosk_host_skips_error_policy_and_warns_it_is_shared_with_the_kiosk(setup):
    result = setup("--host-kind", "kiosk")

    assert result.returncode == 0, result.stderr
    assert not any("printer-error-policy" in command for command in planned(result))
    assert "ใช้ร่วมกับ kiosk" in result.stdout
    assert "abort-job" in result.stdout


@pytest.mark.parametrize("value", ["escpos", '"escpos"', "escpos  "])
def test_kiosk_host_warns_when_the_kiosk_env_uses_the_escpos_backend(setup, tmp_path, value):
    kiosk_env = tmp_path / "kiosk.env"
    kiosk_env.write_text(f"PRINTER_NAME=tent_xprinter\nPRINTER_BACKEND={value}\n")

    result = setup("--host-kind", "kiosk", "--kiosk-env", str(kiosk_env))

    assert result.returncode == 0, result.stderr
    assert "PRINTER_BACKEND=escpos" in result.stdout
    assert str(kiosk_env) in result.stdout


@pytest.mark.parametrize("line", ["PRINTER_BACKEND=cups", "# PRINTER_BACKEND=escpos", ""])
def test_kiosk_host_does_not_warn_about_backend_when_it_is_not_escpos(setup, tmp_path, line):
    kiosk_env = tmp_path / "kiosk.env"
    kiosk_env.write_text(f"{line}\n")

    result = setup("--host-kind", "kiosk", "--kiosk-env", str(kiosk_env))

    assert result.returncode == 0, result.stderr
    assert "escpos" not in result.stdout


def test_standalone_host_ignores_the_kiosk_env(setup, tmp_path):
    kiosk_env = tmp_path / "kiosk.env"
    kiosk_env.write_text("PRINTER_BACKEND=escpos\n")

    result = setup("--host-kind", "standalone", "--kiosk-env", str(kiosk_env))

    assert "escpos" not in result.stdout


def test_allow_cupsenable_adds_the_agent_user_to_the_lpadmin_group(setup):
    result = setup("--host-kind", "standalone", "--allow-cupsenable")

    assert result.returncode == 0, result.stderr
    assert "usermod -aG lpadmin tent-printer" in planned(result)


def test_cupsenable_rights_are_not_granted_by_default(setup):
    result = setup("--host-kind", "standalone")

    assert not any("lpadmin tent-printer" in command for command in planned(result))
    assert not any(command.startswith("usermod") for command in planned(result))


def test_missing_env_file_option_fails_with_a_clear_message_and_plans_nothing(setup):
    result = setup("--host-kind", "standalone", with_env_file=False)

    assert result.returncode != 0
    assert "--env-file" in result.stderr
    assert planned(result) == []


def test_env_file_that_does_not_exist_is_refused(setup, tmp_path):
    result = setup("--host-kind", "standalone", with_env_file=False, env=None)
    assert result.returncode != 0

    missing = tmp_path / "nope.env"
    result = setup("--host-kind", "standalone", "--env-file", str(missing), with_env_file=False)

    assert result.returncode != 0
    assert str(missing) in result.stderr
    assert planned(result) == []


@pytest.mark.parametrize("kind", [None, "laptop"])
def test_host_kind_is_required_and_must_be_standalone_or_kiosk(setup, kind):
    args = ["--host-kind", kind] if kind else []

    result = setup(*args)

    assert result.returncode != 0
    assert "--host-kind" in result.stderr
    assert planned(result) == []


@pytest.mark.parametrize("queue", ["bad name", "q;rm -rf /", "a/b", "$(id)", ""])
def test_invalid_queue_name_is_rejected_before_anything_is_planned(setup, queue):
    result = setup("--host-kind", "standalone", "--queue", queue)

    assert result.returncode != 0
    assert "queue" in result.stderr
    assert planned(result) == []


def test_queue_name_comes_from_printer_name_in_the_env_file_and_is_validated(setup, env_file):
    env_file.write_text(ENV_TEXT.replace("PRINTER_NAME=tent_xprinter", 'PRINTER_NAME="my.queue-2"'))
    result = setup("--host-kind", "standalone")
    assert "lpadmin -p my.queue-2 -o printer-error-policy=abort-job" in planned(result)

    env_file.write_text(ENV_TEXT.replace("PRINTER_NAME=tent_xprinter", "PRINTER_NAME=bad name"))
    result = setup("--host-kind", "standalone")
    assert result.returncode != 0
    assert "queue" in result.stderr


def test_queue_option_overrides_the_env_file_and_defaults_to_tent_xprinter(setup, env_file):
    result = setup("--host-kind", "standalone", "--queue", "label_q")
    assert "lpadmin -p label_q -o printer-error-policy=abort-job" in planned(result)

    env_file.write_text(ENV_TEXT.replace("PRINTER_NAME=tent_xprinter\n", ""))
    result = setup("--host-kind", "standalone")
    assert "lpadmin -p tent_xprinter -o printer-error-policy=abort-job" in planned(result)


def test_env_file_contents_are_never_printed(setup):
    for args in (["--host-kind", "standalone"], ["--host-kind", "kiosk", "--allow-cupsenable"]):
        result = setup(*args)

        assert result.returncode == 0, result.stderr
        assert FAKE_SECRET not in result.stdout
        assert FAKE_SECRET not in result.stderr


def test_missing_service_user_is_created_as_a_system_user_in_group_lp(setup):
    result = setup("--host-kind", "standalone")

    assert (
        "useradd --system --gid lp --no-create-home --shell /usr/sbin/nologin tent-printer"
        in planned(result)
    )


def test_existing_service_user_is_not_created_again(setup):
    result = setup("--host-kind", "standalone", env={"FAKE_USER_EXISTS": "1"})

    assert not any(command.startswith("useradd") for command in planned(result))


def test_project_is_synced_to_the_prefix_without_dev_scripts_and_deps_are_frozen(setup):
    result = setup("--host-kind", "standalone", "--prefix", "/srv/tent/printer")
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
    result = setup("--host-kind", "standalone")

    assert f"install -m 600 -o tent-printer -g lp {env_file} /opt/tent/printer/.env" in planned(
        result
    )


def test_unit_is_installed_with_the_prefix_then_enabled_and_started(setup, tmp_path):
    unit_dir = tmp_path / "units"

    result = setup(
        "--host-kind", "standalone", "--prefix", "/srv/tent/printer", "--unit-dir", str(unit_dir)
    )
    plan = planned(result)

    unit = next(
        i for i, command in enumerate(plan) if f"{unit_dir}/tent-printer.service" in command
    )
    assert "/srv/tent/printer" in plan[unit]
    assert plan.index("systemctl daemon-reload") > unit
    assert plan.index("systemctl enable --now tent-printer") > plan.index("systemctl daemon-reload")


def test_steps_run_in_install_order(setup):
    result = setup("--host-kind", "standalone", "--allow-cupsenable")
    plan = planned(result)

    def at(prefix: str) -> int:
        return next(i for i, command in enumerate(plan) if command.startswith(prefix))

    assert (
        at("useradd")
        < at("rsync")
        < at("uv sync")
        < at("install -m 600")
        < at("lpadmin -p")
        < at("usermod")
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
        "--host-kind",
        "standalone",
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
