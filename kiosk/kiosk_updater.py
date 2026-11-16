"""Update the kiosk client to the commit tag `kiosk-stable` points at, once per boot.

start_kiosk.sh runs this before the supervisor loop. Any failure keeps the current version, so a
kiosk always boots. Usage: python kiosk_updater.py
"""

import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

STABLE_TAG = "kiosk-stable"
PIP_SNAPSHOT = "pip-freeze.txt"
# Only a kiosk with this branch checked out updates itself, and only to a commit on origin/main.
# Checking out any other branch (or detaching) is how a kiosk opts out, e.g. to test develop.
RELEASE_BRANCH = "main"
# The package itself, not playwright-stealth and the like.
PLAYWRIGHT_LINE = re.compile(r"^playwright\s*($|[<>=!~;\[])")


def _git(cwd, *args, timeout=None):
    # Never wait on a credential prompt: nobody is at the kiosk to answer it.
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True, timeout=timeout, env=env
    ).stdout.strip()


def update_on_boot(kiosk_dir, *, run_step, remote="origin", fetch_timeout=20):
    kiosk_dir = Path(kiosk_dir)
    try:
        branch = _git(kiosk_dir, "symbolic-ref", "-q", "--short", "HEAD")
    except subprocess.CalledProcessError:
        branch = None
    if branch != RELEASE_BRANCH:
        return "disabled"
    # The tag moves on every release, so fetch it with force (+) or git keeps the old one.
    try:
        _git(
            kiosk_dir,
            "fetch",
            "-q",
            "--no-tags",
            remote,
            f"+refs/tags/{STABLE_TAG}:refs/tags/{STABLE_TAG}",
            f"+refs/heads/{RELEASE_BRANCH}:refs/remotes/{remote}/{RELEASE_BRANCH}",
            timeout=fetch_timeout,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return "offline"
    current = _git(kiosk_dir, "rev-parse", "HEAD")
    target = _git(kiosk_dir, "rev-parse", f"{STABLE_TAG}^{{commit}}")
    pending = state_dir(kiosk_dir) / "pending"
    # A pending marker means the last update died mid-install (power cut): HEAD is already the new
    # code but its packages may not be, so install again from the version it left.
    base = pending.read_text().strip() if pending.exists() else current
    if target == current and base == current:
        return "up-to-date"
    # A hotfix made by hand on site would be lost or block checkout; leave it for a person.
    if _git(kiosk_dir, "status", "--porcelain", "--untracked-files=no"):
        return "dirty"
    # Moving a tag needs only write access; reaching main needs a reviewed PR.
    if not _is_ancestor(kiosk_dir, target, f"{remote}/{RELEASE_BRANCH}"):
        return "untrusted"
    steps = _steps_between(kiosk_dir, base, target)
    pending.parent.mkdir(exist_ok=True)
    pending.write_text(base)
    _git(kiosk_dir, "checkout", "-q", "-B", RELEASE_BRANCH, target)
    attempted = []
    for step in steps:
        attempted.append(step)
        if not _try_step(run_step, step, kiosk_dir):
            _git(kiosk_dir, "checkout", "-q", "-B", RELEASE_BRANCH, base)
            # Undo every step the new version touched, the failed one too: it may have half-run.
            for undo in sorted(attempted, key=UNDO_ORDER.index):
                _try_step(run_step, UNDO_STEP[undo], kiosk_dir)
            _finish(kiosk_dir)
            return "rolled-back"
    _finish(kiosk_dir)
    return "updated"


# pip install -r of the old requirements keeps newer packages (they all use >=), so "pip" saves a
# pip freeze first and "pip-restore" installs it back. Playwright and models re-run the old version.
UNDO_STEP = {"pip": "pip-restore", "playwright": "playwright", "models": "models"}
UNDO_ORDER = ["pip", "playwright", "models"]


def _try_step(run_step, step, kiosk_dir):
    try:
        return run_step(step, kiosk_dir)
    except Exception as error:
        log(f"{step} raised {type(error).__name__}: {error}")
        return False


def _finish(kiosk_dir):
    for file in ("pending", PIP_SNAPSHOT):
        (state_dir(kiosk_dir) / file).unlink(missing_ok=True)


def _is_ancestor(kiosk_dir, commit, ref):
    try:
        _git(kiosk_dir, "merge-base", "--is-ancestor", commit, ref)
        return True
    except subprocess.CalledProcessError:
        return False


def state_dir(kiosk_dir):
    # Inside .git: survives reboots, is never tracked, and moves with the checkout.
    git_dir = _git(kiosk_dir, "rev-parse", "--absolute-git-dir")
    return Path(git_dir) / "kiosk-update"


def _steps_between(kiosk_dir, current, target):
    changed = _git(kiosk_dir, "diff", "--relative", "--name-only", current, target).splitlines()
    steps = []
    if "requirements.txt" in changed:
        steps.append("pip")
        # The browser build is pinned to the playwright package, so a new version needs a new one.
        if _playwright_pin(kiosk_dir, current) != _playwright_pin(kiosk_dir, target):
            steps.append("playwright")
    if "models/download_models.sh" in changed:
        steps.append("models")
    return steps


def _playwright_pin(kiosk_dir, commit):
    requirements = _git(kiosk_dir, "show", f"{commit}:./requirements.txt")
    return [line for line in requirements.splitlines() if PLAYWRIGHT_LINE.match(line)]


# start_kiosk.sh re-executes itself on this code: bash reads a script as it runs, so it must not
# keep running a start_kiosk.sh that the checkout just replaced.
UPDATED_EXIT = 10
# Bounds one install step so a network drop after the fetch cannot hold the boot screen forever.
STEP_TIMEOUT = 600
# /tmp/kiosk_autostart.log is gone after a reboot; keep the updater's history where it survives.
LOG_FILE = Path.home() / ".local/state/smart-shelter-kiosk/updater.log"


def log(message):
    line = f"[kiosk-updater] {datetime.now().isoformat(timespec='seconds')} {message}"
    print(line, flush=True)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a") as file:
            file.write(line + "\n")
    except OSError:
        pass


def run_install_step(step, kiosk_dir):
    if step == "playwright" and _uses_system_chromium(kiosk_dir):
        return True
    snapshot = state_dir(kiosk_dir) / PIP_SNAPSHOT
    pip = [sys.executable, "-m", "pip"]
    if step == "pip" and not snapshot.exists():
        # Only the first attempt saves it: after a power cut the venv may already be half-new.
        freeze = subprocess.run([*pip, "freeze"], capture_output=True, text=True, timeout=STEP_TIMEOUT)
        if freeze.returncode != 0:
            return False
        snapshot.write_text(freeze.stdout)
    if step == "pip-restore" and not snapshot.exists():
        return False
    commands = {
        "pip": [*pip, "install", "-q", "-r", "requirements.txt"],
        "pip-restore": [*pip, "install", "-q", "-r", str(snapshot)],
        "playwright": [sys.executable, "-m", "playwright", "install", "chromium"],
        "models": ["bash", "models/download_models.sh"],
    }
    log(f"running {step}")
    try:
        return subprocess.run(commands[step], cwd=kiosk_dir, timeout=STEP_TIMEOUT).returncode == 0
    except subprocess.TimeoutExpired:
        log(f"{step} timed out after {STEP_TIMEOUT}s")
        return False


def _uses_system_chromium(kiosk_dir):
    # Raspberry Pi kiosks run the apt Chromium (README Step 5), not the one playwright downloads.
    if os.environ.get("BROWSER_EXECUTABLE_PATH"):
        return True
    # Stdlib only: the updater has to run even when the venv it is about to repair is broken.
    env_file = Path(kiosk_dir) / ".env"
    lines = env_file.read_text().splitlines() if env_file.exists() else []
    return any(line.startswith("BROWSER_EXECUTABLE_PATH=") and line.split("=", 1)[1].strip() for line in lines)


def main(kiosk_dir=None, run_step=run_install_step):
    kiosk_dir = Path(kiosk_dir or Path(__file__).resolve().parent)
    before = None
    try:
        before = _git(kiosk_dir, "rev-parse", "--short", "HEAD")
        outcome = update_on_boot(kiosk_dir, run_step=run_step)
    except Exception as error:  # an update problem must never stop the kiosk from booting
        outcome = f"skipped: {type(error).__name__}: {error}"
    # Decide on where HEAD is, not on the outcome: whatever happened, if the code under
    # start_kiosk.sh changed it has to re-exec.
    try:
        after = _git(kiosk_dir, "rev-parse", "--short", "HEAD")
    except Exception:
        after = None
    log(f"{outcome}: {before} -> {after}")
    return UPDATED_EXIT if after != before else 0


if __name__ == "__main__":
    sys.exit(main())
