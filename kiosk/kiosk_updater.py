"""Update the kiosk client to the commit tag `kiosk-stable` points at, once per boot.

start_kiosk.sh runs this before the supervisor loop. Any failure keeps the current version, so a
kiosk always boots. Usage: python kiosk_updater.py
"""

import os
import subprocess
import sys
from pathlib import Path

STABLE_TAG = "kiosk-stable"


def _git(cwd, *args, timeout=None):
    # Never wait on a credential prompt: nobody is at the kiosk to answer it.
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True, timeout=timeout, env=env
    ).stdout.strip()


def update_on_boot(kiosk_dir, *, run_step, remote="origin", fetch_timeout=20):
    kiosk_dir = Path(kiosk_dir)
    # The tag moves on every release, so fetch it with force (+) or git keeps the old one.
    try:
        _git(
            kiosk_dir,
            "fetch",
            "-q",
            "--no-tags",
            remote,
            f"+refs/tags/{STABLE_TAG}:refs/tags/{STABLE_TAG}",
            timeout=fetch_timeout,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return "offline"
    current = _git(kiosk_dir, "rev-parse", "HEAD")
    target = _git(kiosk_dir, "rev-parse", f"{STABLE_TAG}^{{commit}}")
    if target == current:
        return "up-to-date"
    # A hotfix made by hand on site would be lost or block checkout; leave it for a person.
    if _git(kiosk_dir, "status", "--porcelain", "--untracked-files=no"):
        return "dirty"
    steps = _steps_between(kiosk_dir, current, target)
    _git(kiosk_dir, "checkout", "-q", "--detach", target)
    done = []
    for step in steps:
        if not run_step(step, kiosk_dir):
            _git(kiosk_dir, "checkout", "-q", "--detach", current)
            # Undo what the new version already installed so the old code finds its own packages.
            for undo in done:
                run_step(undo, kiosk_dir)
            return "rolled-back"
        done.append(step)
    return "updated"


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
    return [line for line in requirements.splitlines() if line.startswith("playwright")]


# start_kiosk.sh re-executes itself on this code: bash reads a script as it runs, so it must not
# keep running a start_kiosk.sh that the checkout just replaced.
UPDATED_EXIT = 10


def run_install_step(step, kiosk_dir):
    if step == "playwright" and _uses_system_chromium(kiosk_dir):
        return True
    commands = {
        "pip": [sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt"],
        "playwright": [sys.executable, "-m", "playwright", "install", "chromium"],
        "models": ["bash", "models/download_models.sh"],
    }
    print(f"[kiosk-updater] running {step}", flush=True)
    return subprocess.run(commands[step], cwd=kiosk_dir).returncode == 0


def _uses_system_chromium(kiosk_dir):
    # Raspberry Pi kiosks run the apt Chromium (README Step 5), not the one playwright downloads.
    if os.environ.get("BROWSER_EXECUTABLE_PATH"):
        return True
    # Stdlib only: the updater has to run even when the venv it is about to repair is broken.
    env_file = Path(kiosk_dir) / ".env"
    lines = env_file.read_text().splitlines() if env_file.exists() else []
    return any(line.startswith("BROWSER_EXECUTABLE_PATH=") and line.split("=", 1)[1].strip() for line in lines)


def main():
    kiosk_dir = Path(__file__).resolve().parent
    try:
        before = _git(kiosk_dir, "rev-parse", "--short", "HEAD")
        outcome = update_on_boot(kiosk_dir, run_step=run_install_step)
        after = _git(kiosk_dir, "rev-parse", "--short", "HEAD")
    except Exception as error:  # an update problem must never stop the kiosk from booting
        print(f"[kiosk-updater] skipped: {type(error).__name__}: {error}", flush=True)
        return 0
    print(f"[kiosk-updater] {outcome}: {before} -> {after}", flush=True)
    return UPDATED_EXIT if outcome == "updated" else 0


if __name__ == "__main__":
    sys.exit(main())
