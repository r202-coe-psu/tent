"""Update the kiosk client to the commit tag `kiosk-stable` points at, once per boot.

start_kiosk.sh runs this before the supervisor loop. Any failure keeps the current version, so a
kiosk always boots. Usage: python kiosk_updater.py
"""

import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

STABLE_TAG = "kiosk-stable"
PIP_SNAPSHOT = "pip-freeze.txt"
# Only a kiosk with this branch checked out updates itself, and only to a commit on origin/main.
# Checking out any other branch (or detaching) is how a kiosk opts out, e.g. to test develop.
RELEASE_BRANCH = "main"
# The package itself, not playwright-stealth and the like.
PLAYWRIGHT_LINE = re.compile(r"^playwright\s*($|[<>=!~;\[@])", re.IGNORECASE)


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
    pending = state_dir(kiosk_dir) / "pending"
    # A pending marker ("<base>\n<target>\n", plus "undo" once a rollback put the tree back on
    # base) means the last update died part way (power cut, or a rollback that could not finish):
    # HEAD may be the new code on half-installed packages, or a half-written checkout. Finish what
    # it started, from the version it left.
    resuming = pending.exists()
    recorded = pending.read_text().split() if resuming else []
    current = _git(kiosk_dir, "rev-parse", "HEAD")
    base = recorded[0] if recorded else current
    started = recorded[1] if len(recorded) > 1 else current
    rolled_back = "undo" in recorded[2:]
    # A power cut mid-fetch or mid-checkout leaves git's locks behind and every later git command
    # fails on them; nothing else runs git at boot.
    git_dir = Path(_git(kiosk_dir, "rev-parse", "--absolute-git-dir"))
    for lock in (
        "index.lock",
        "HEAD.lock",
        f"refs/heads/{RELEASE_BRANCH}.lock",
        f"refs/tags/{STABLE_TAG}.lock",
        f"refs/remotes/{remote}/{RELEASE_BRANCH}.lock",
    ):
        (git_dir / lock).unlink(missing_ok=True)
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
        target = _git(kiosk_dir, "rev-parse", f"{STABLE_TAG}^{{commit}}")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        if not resuming:
            return "offline"
        # Its objects are already here and it passed every check when it started.
        target = started
    # Moving a tag needs only write access; reaching main needs a reviewed PR.
    if not _is_ancestor(kiosk_dir, target, f"{remote}/{RELEASE_BRANCH}"):
        if not resuming:
            return "untrusted"
        target = started
    # A commit made on the kiosk: checkout -B would drop it from main. HEAD is otherwise always a
    # version the updater put there, all on main.
    if not _is_ancestor(kiosk_dir, current, f"{remote}/{RELEASE_BRANCH}"):
        return "diverged"
    # A hotfix made by hand on site would be lost; leave it for a person. Only the files an
    # interrupted checkout was rewriting may differ, and those are the updater's own.
    # After a rollback the tree is back on base, so no file is the updater's any more.
    rewriting = resuming and not rolled_back
    # --no-renames: with rename detection the old path of a renamed file is not listed at all.
    ours = set(_git(kiosk_dir, "diff", "--no-renames", "--name-only", base, started).splitlines()) if rewriting else set()
    modified = _git(kiosk_dir, "diff", "--no-renames", "--name-only", "HEAD").splitlines()
    if any(path not in ours for path in modified):
        return "dirty"
    if not resuming:
        if target == current:
            return "up-to-date"
        # Left by an update that died after clearing its marker: it describes an older venv.
        (pending.parent / PIP_SNAPSHOT).unlink(missing_ok=True)
    elif target == base:
        return _restore(kiosk_dir, run_step, base, started)
    # Git overwrites an ignored file (a device's .env, say) without asking when a release starts
    # tracking that path; refuse like a hand edit.
    top = Path(git_dir).parent
    added = _git(kiosk_dir, "diff", "--no-renames", "--name-only", "--diff-filter=A", "HEAD", target).splitlines()
    if any((top / path).exists() and path not in ours for path in added):
        return "dirty"
    steps = _steps_between(kiosk_dir, base, target)
    _write_atomic(pending, f"{base}\n{target}\n")
    try:
        # -f only to finish the updater's own half-written checkout; otherwise git refuses to
        # overwrite an untracked file the release starts tracking.
        _git(kiosk_dir, "checkout", "-q", *(["-f"] if rewriting else []), "-B", RELEASE_BRANCH, target)
    except subprocess.CalledProcessError as error:
        # Only a refusal before git wrote anything may drop the marker; any other failure may
        # have left a half-written tree for the next boot to finish.
        if not resuming and "would be overwritten" in (error.stderr or ""):
            pending.unlink()
        return "dirty"
    if _tree_differs(kiosk_dir):
        # Git exits 0 after "unable to create file" (full SD card, I/O error): go back to base.
        # If that checkout is whole too, nothing changed; otherwise the next boot finishes it.
        _git(kiosk_dir, "checkout", "-q", "-f", "-B", RELEASE_BRANCH, base)
        if not _tree_differs(kiosk_dir):
            _finish(kiosk_dir)
        return "dirty"
    attempted = []
    for step in steps:
        attempted.append(step)
        if not _try_step(run_step, step, kiosk_dir):
            _git(kiosk_dir, "checkout", "-q", "-f", "-B", RELEASE_BRANCH, base)
            if _tree_differs(kiosk_dir):  # the next boot finishes this checkout
                return "rolled-back"
            _write_atomic(pending, f"{base}\n{target}\nundo\n")
            # Undo every step the new version touched, the failed one too: it may have half-run.
            undone = _undo(kiosk_dir, run_step, attempted)
            # A failed undo keeps the marker and pip snapshot, so the next boot tries again from
            # the true old package set instead of freezing this mixed one.
            if all(undone):
                _finish(kiosk_dir)
            return "rolled-back"
    _finish(kiosk_dir)
    return "updated"


# pip install -r of the old requirements keeps newer packages (they all use >=), so "pip" saves a
# pip freeze first and "pip-restore" installs it back. Playwright and models re-run the old version.
UNDO_STEP = {"pip": "pip-restore", "playwright": "playwright", "models": "models"}
UNDO_ORDER = ["pip", "playwright", "models"]


def _restore(kiosk_dir, run_step, base, started):
    # kiosk-stable went back to the version an unfinished update or rollback left: undo everything
    # that release could have installed.
    _git(kiosk_dir, "checkout", "-q", "-f", "-B", RELEASE_BRANCH, base)
    if _tree_differs(kiosk_dir):  # the next boot finishes this checkout
        return "rolled-back"
    _write_atomic(state_dir(kiosk_dir) / "pending", f"{base}\n{started}\nundo\n")
    steps = _steps_between(kiosk_dir, base, started)
    if not (state_dir(kiosk_dir) / PIP_SNAPSHOT).exists() and "pip" in steps:
        steps.remove("pip")  # no snapshot: pip never ran, so there is nothing to put back
    if not all(_undo(kiosk_dir, run_step, steps)):
        return "rolled-back"
    _finish(kiosk_dir)
    return "restored"


def _tree_differs(kiosk_dir):
    return bool(_git(kiosk_dir, "diff", "--no-renames", "--name-only", "HEAD"))


def _undo(kiosk_dir, run_step, steps):
    global _deadline
    # The install may have spent the whole boot budget; the rollback gets time of its own.
    if _deadline is not None:
        _deadline = time.monotonic() + BOOT_BUDGET
    return [_try_step(run_step, UNDO_STEP[step], kiosk_dir) for step in sorted(steps, key=UNDO_ORDER.index)]


def _try_step(run_step, step, kiosk_dir):
    try:
        return run_step(step, kiosk_dir)
    except Exception as error:
        log(f"{step} raised {type(error).__name__}: {error}")
        return False


def _write_atomic(path, text):
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    # fsync before the rename: after a power cut the file is either the old one or complete.
    with tmp.open("w") as file:
        file.write(text)
        file.flush()
        os.fsync(file.fileno())
    os.replace(tmp, path)


def _finish(kiosk_dir):
    # Snapshot first: a marker without one only costs a fresh freeze, never a stale restore.
    for file in (PIP_SNAPSHOT, "pending"):
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
    changed = _git(kiosk_dir, "diff", "--no-renames", "--relative", "--name-only", current, target).splitlines()
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
    try:
        requirements = _git(kiosk_dir, "show", f"{commit}:./requirements.txt")
    except subprocess.CalledProcessError:  # a version without requirements.txt pins nothing
        return []
    return [line for line in requirements.splitlines() if PLAYWRIGHT_LINE.match(line)]


# start_kiosk.sh re-executes itself on this code: bash reads a script as it runs, so it must not
# keep running a start_kiosk.sh that the checkout just replaced.
UPDATED_EXIT = 10
# Bound one install step, and all of them together, so a network drop after the fetch cannot hold
# the boot screen for long. Steps cut short by the total budget fail and roll back; a rollback that
# runs out of time keeps its marker and finishes on the next boot.
STEP_TIMEOUT = 600
BOOT_BUDGET = 1200
_deadline = None
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


# The line main() logs once per boot: "<outcome>: <short HEAD before> -> <short HEAD after>".
OUTCOME_LINE = re.compile(r"^\[kiosk-updater\] (?P<at>\S+) (?P<outcome>.+): (?P<before>\S+) -> (?P<after>\S+)$")


def update_info(kiosk_dir, log_file=None):
    """For the kiosk info panel: the commit running now, when an update last changed it, and what
    the last boot check said. Anything unreadable is None, never raised."""
    try:
        commit = _git(kiosk_dir, "rev-parse", "--short=7", "HEAD", timeout=2)
    except (OSError, subprocess.SubprocessError):
        commit = None
    try:
        lines = (log_file or LOG_FILE).read_text(errors="replace").splitlines()
    except OSError:
        lines = []
    updated_at = last_check = None
    for line in lines:
        match = OUTCOME_LINE.match(line)
        if not match:
            continue
        # "skipped: OSError: ..." is too long for the panel; the log keeps the detail.
        last_check = {"at": match["at"], "outcome": match["outcome"].split(":", 1)[0]}
        if match["before"] != match["after"]:
            updated_at = match["at"]
    return {"commit": commit, "updated_at": updated_at, "last_check": last_check}


def run_install_step(step, kiosk_dir):
    if step == "playwright" and _uses_system_chromium(kiosk_dir):
        return True
    snapshot = state_dir(kiosk_dir) / PIP_SNAPSHOT
    pip = [sys.executable, "-m", "pip"]
    if step == "pip" and not snapshot.exists():
        # Only the first attempt saves it: after a power cut the venv may already be half-new.
        freeze = subprocess.run([*pip, "freeze"], capture_output=True, text=True, timeout=_step_timeout())
        if freeze.returncode != 0:
            return False
        _write_atomic(snapshot, freeze.stdout)
    if step == "pip-restore" and not snapshot.exists():
        return False
    commands = {
        "pip": [*pip, "install", "-q", "-r", "requirements.txt"],
        "pip-restore": [*pip, "install", "-q", "-r", str(snapshot)],
        "playwright": [sys.executable, "-m", "playwright", "install", "chromium"],
        "models": ["bash", "models/download_models.sh"],
    }
    log(f"running {step}")
    return run_command(commands[step], kiosk_dir, _step_timeout())


def _step_timeout():
    if _deadline is None:
        return STEP_TIMEOUT
    return max(1, min(STEP_TIMEOUT, _deadline - time.monotonic()))


def run_command(command, cwd, timeout):
    # Own process group: on timeout kill what the step started too (curl under download_models.sh,
    # node under playwright), or it keeps writing while the rollback runs.
    process = subprocess.Popen(command, cwd=cwd, start_new_session=True)
    try:
        return process.wait(timeout=timeout) == 0
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        log(f"{command[-1]} timed out after {timeout:.0f}s")
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
    global _deadline
    _deadline = time.monotonic() + BOOT_BUDGET
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
